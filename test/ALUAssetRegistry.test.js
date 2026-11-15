const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Hash the real logo file so the tests use the true value, not a placeholder
const logoBytes = fs.readFileSync(path.join(__dirname, "..", "alu-logo.png"));
const ALU_LOGO_HASH = "0x" + crypto.createHash("sha256").update(logoBytes).digest("hex");

// A different hash to act as a "fake" logo
const FAKE_HASH = ethers.keccak256(ethers.toUtf8Bytes("not the real ALU logo"));

describe("ALUAssetRegistry (Part B)", function () {
  let registry, owner;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    registry = await ethers.deployContract("ALUAssetRegistry");
    await registry.waitForDeployment();
  });

  it("1. registers the ALU logo and returns a token ID", async function () {
    // staticCall shows what the function returns without sending a tx
    const returnedId = await registry.registerAsset.staticCall(
      "ALU Official Logo", "image/png", ALU_LOGO_HASH
    );
    expect(returnedId).to.equal(1n);

    await expect(registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH))
      .to.emit(registry, "AssetRegistered");
    expect(await registry.ownerOf(1)).to.equal(owner.address);
  });

  it("2. rejects registering the same hash a second time", async function () {
    await registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH);
    await expect(
      registry.registerAsset("ALU Logo Copy", "image/png", ALU_LOGO_HASH)
    ).to.be.revertedWith("This asset has already been registered");
  });

  it("3. verifyLogoIntegrity() returns true for the correct hash", async function () {
    await registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH);
    const [ok, message] = await registry.verifyLogoIntegrity(1, ALU_LOGO_HASH);
    expect(ok).to.equal(true);
    expect(message).to.equal("Logo is authentic.");
  });

  it("4. verifyLogoIntegrity() returns false for a wrong hash", async function () {
    await registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH);
    const [ok, message] = await registry.verifyLogoIntegrity(1, FAKE_HASH);
    expect(ok).to.equal(false);
    expect(message).to.equal("Warning: logo does not match.");
  });

  it("5. getAsset() returns the correct name and file type", async function () {
    await registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH);
    const asset = await registry.getAsset(1);
    expect(asset.assetName).to.equal("ALU Official Logo");
    expect(asset.fileType).to.equal("image/png");
    expect(asset.contentHash).to.equal(ALU_LOGO_HASH);
    expect(asset.registeredBy).to.equal(owner.address);
  });
});

describe("ALULogoToken (Part C)", function () {
  let token, owner, faculty;

  beforeEach(async function () {
    [owner, faculty] = await ethers.getSigners();
    token = await ethers.deployContract("ALULogoToken", [owner.address]);
    await token.waitForDeployment();
  });

  it("6. mints the full 1,000,000 ALUT to the logo owner on deployment", async function () {
    expect(await token.totalSupply()).to.equal(1_000_000n);
    expect(await token.balanceOf(owner.address)).to.equal(1_000_000n);
    expect(await token.name()).to.equal("ALU Logo Token");
    expect(await token.symbol()).to.equal("ALUT");
  });

  it("7. distributeShares() transfers tokens to a recipient", async function () {
    await token.distributeShares(faculty.address, 100_000);
    expect(await token.balanceOf(faculty.address)).to.equal(100_000n);
    expect(await token.balanceOf(owner.address)).to.equal(900_000n);
  });

  it("8. ownershipPercentage() returns the correct percentage", async function () {
    await token.distributeShares(faculty.address, 500_000);
    expect(await token.ownershipPercentage(faculty.address)).to.equal(50n);
    expect(await token.ownershipPercentage(owner.address)).to.equal(50n);
  });
});

// ------------------------------------------------------------------
// Formative 2: frontend integration tests
// These call the SAME functions the web page uses (frontend/src/lib/dapp.js)
// against freshly deployed contracts.
// ------------------------------------------------------------------
const { pathToFileURL } = require("url");

describe("Frontend integration (Formative 2)", function () {
  let dapp, registry, token, owner, recipient;

  before(async function () {
    // dapp.js is an ES module (the browser code), so it is loaded with import()
    dapp = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "lib", "dapp.js")).href);
  });

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();
    registry = await ethers.deployContract("ALUAssetRegistry");
    token = await ethers.deployContract("ALULogoToken", [owner.address]);
    await registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH);
  });

  it("9. reads the total ALUT supply and displays 1,000,000", async function () {
    const supply = await dapp.readTotalSupply(token);
    expect(supply.value).to.equal(1_000_000n);
    expect(supply.display).to.equal("1,000,000");
  });

  it("10. hashing function returns the correct SHA-256 hash in bytes32 format", async function () {
    // Same kind of File object the browser's file picker gives us
    const file = new File([logoBytes], "alu-logo.png", { type: "image/png" });
    const result = await dapp.hashFile(file);
    expect(result.bytes32).to.equal(ALU_LOGO_HASH);
    expect(result.bytes32).to.match(/^0x[0-9a-f]{64}$/); // valid bytes32
  });

  it("11. displays a verification success result for the correct ALU logo hash", async function () {
    const view = await dapp.verifyLogo(registry, 1, ALU_LOGO_HASH);
    const html = dapp.renderVerificationHTML(view);
    expect(view.status).to.equal("authentic");
    expect(html).to.include("Logo Verified");
    expect(html).to.include("This is the authentic ALU logo.");
    expect(html).to.include("ALU Official Logo");
  });

  it("12. displays a verification failure result for an incorrect hash", async function () {
    const view = await dapp.verifyLogo(registry, 1, FAKE_HASH);
    const html = dapp.renderVerificationHTML(view);
    expect(view.status).to.equal("fake");
    expect(html).to.include("Warning: This logo has been modified");
    expect(html).to.not.include("Logo Verified");
  });

  it("13. distributeShares() updates the recipient's balance after the transfer", async function () {
    const before = await token.balanceOf(recipient.address);
    const result = await dapp.distributeShares(token, recipient.address, "25000");
    expect(before).to.equal(0n);
    expect(result.recipientBalance).to.equal(25_000n);
    expect(await token.balanceOf(owner.address)).to.equal(975_000n);
  });
});
