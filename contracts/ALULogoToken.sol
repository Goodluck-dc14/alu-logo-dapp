// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ALULogoToken (ALUT)
 * @notice ERC-20 token that splits ownership of the ALU logo into 1,000,000 shares.
 *         decimals() is set to 0, so 1 ALUT = 1 whole share (no fractions).
 */
contract ALULogoToken is ERC20, Ownable {
    // Fixed total supply: 1,000,000 shares
    uint256 public constant TOTAL_SUPPLY = 1_000_000;

    // Fired when the owner gives shares to someone
    event SharesDistributed(address indexed recipient, uint256 amount);

    /**
     * @param logoOwner wallet that receives all 1,000,000 tokens at the start
     *                  and becomes the contract owner
     */
    constructor(address logoOwner)
        ERC20("ALU Logo Token", "ALUT")
        Ownable(logoOwner) // also reverts if logoOwner is the zero address
    {
        _mint(logoOwner, TOTAL_SUPPLY);
    }

    /// @notice Shares are whole units, so no decimals
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /**
     * @notice Function 4 - owner sends ALUT shares to a stakeholder.
     * @param recipient wallet receiving the shares
     * @param amount    number of ALUT to send
     */
    function distributeShares(address recipient, uint256 amount) public onlyOwner {
        require(amount > 0, "Amount must be greater than zero");
        require(recipient != address(0), "Recipient cannot be the zero address");
        // _transfer also reverts if the owner does not have enough tokens
        _transfer(owner(), recipient, amount);
        emit SharesDistributed(recipient, amount);
    }

    /**
     * @notice Function 5 - ownership percentage of a wallet as a whole number.
     *         500,000 ALUT => 50. Anything below 1% rounds down to 0.
     */
    function ownershipPercentage(address account) public view returns (uint256) {
        return (balanceOf(account) * 100) / TOTAL_SUPPLY;
    }
}
