// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title ALUAssetRegistry
 * @notice Registers the official ALU logo as an NFT (ERC-721).
 *         The SHA-256 fingerprint of the logo file is stored on-chain so
 *         anyone can later check if a logo file is the real one or a fake.
 */
contract ALUAssetRegistry is ERC721 {
    // Everything we save about one registered asset
    struct AssetMetadata {
        string assetName;     // e.g. "ALU Official Logo"
        string fileType;      // e.g. "image/png"
        bytes32 contentHash;  // SHA-256 hash of the actual file
        address registeredBy; // wallet that registered it
        uint256 registeredAt; // Unix timestamp of registration
    }

    // Counter used to give each new token a unique ID (first token is 1)
    uint256 private _tokenIdCounter;

    // Mapping 1: token ID => its metadata (anyone can look it up)
    mapping(uint256 => AssetMetadata) private _assets;

    // Mapping 2: content hash => true if already registered (blocks duplicates)
    mapping(bytes32 => bool) private _hashRegistered;

    // Fired every time a new asset is registered
    event AssetRegistered(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 indexed contentHash,
        string assetName,
        string fileType,
        uint256 timestamp
    );

    constructor() ERC721("ALU Asset Registry", "ALUAR") {}

    /**
     * @notice Function 1 - register a new asset and mint an NFT for it.
     * @param assetName   name of the asset
     * @param fileType    file type of the asset
     * @param contentHash SHA-256 hash of the file, as bytes32
     * @return tokenId    ID of the newly minted NFT
     */
    function registerAsset(
        string memory assetName,
        string memory fileType,
        bytes32 contentHash
    ) public returns (uint256) {
        // Basic input checks
        require(contentHash != bytes32(0), "Content hash cannot be empty");
        require(bytes(assetName).length > 0, "Asset name cannot be empty");

        // Reject the same file being registered twice
        require(!_hashRegistered[contentHash], "This asset has already been registered");

        // New unique token ID
        _tokenIdCounter += 1;
        uint256 newTokenId = _tokenIdCounter;

        // Save the data and mark the hash as used BEFORE minting.
        // _safeMint can call into the receiver contract, so we update our
        // own state first (checks-effects-interactions pattern).
        _assets[newTokenId] = AssetMetadata({
            assetName: assetName,
            fileType: fileType,
            contentHash: contentHash,
            registeredBy: msg.sender,
            registeredAt: block.timestamp
        });
        _hashRegistered[contentHash] = true;

        // Mint the NFT to whoever called the function
        _safeMint(msg.sender, newTokenId);

        emit AssetRegistered(newTokenId, msg.sender, contentHash, assetName, fileType, block.timestamp);

        return newTokenId;
    }

    /**
     * @notice Function 2 - check if a hash matches the one stored for a token.
     *         Read-only, so it costs no gas when called from outside.
     */
    function verifyLogoIntegrity(uint256 tokenId, bytes32 contentHash)
        public
        view
        returns (bool, string memory)
    {
        require(_assets[tokenId].registeredAt != 0, "Token does not exist");

        if (_assets[tokenId].contentHash == contentHash) {
            return (true, "Logo is authentic.");
        }
        return (false, "Warning: logo does not match.");
    }

    /**
     * @notice Function 3 - return all registration details for a token.
     */
    function getAsset(uint256 tokenId) public view returns (AssetMetadata memory) {
        require(_assets[tokenId].registeredAt != 0, "Token does not exist");
        return _assets[tokenId];
    }

    /// @notice Helper: has this hash already been registered?
    function isHashRegistered(bytes32 contentHash) public view returns (bool) {
        return _hashRegistered[contentHash];
    }

    /// @notice Helper: how many assets have been registered so far
    function totalRegistered() public view returns (uint256) {
        return _tokenIdCounter;
    }
}
