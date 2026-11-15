// Deploys ALUAssetRegistry, registers the real ALU logo, deploys ALULogoToken,
// gives example shares to three stakeholder wallets, then writes the ABIs and
// contract addresses into the frontend so the dApp can talk to the contracts.
//
// Local:   npx hardhat run scripts/deploy.js --network localhost
// Sepolia: npx hardhat run scripts/deploy.js --network sepolia
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// SHA-256 of alu-logo.png (also printed by: node scripts/hashLogo.js)
const ALU_LOGO_HASH =
  "0xe1c249b379dece3552de9559ba3bc2e9af5cc242d56f0869fb11a2eff4f5d73c";

// Example ALUT holders shown on the dashboard (Hardhat test accounts #1 to #3)
const EXAMPLE_HOLDERS = [
  { label: "Faculty Senate", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", amount: 100000 },
  { label: "Student Council", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", amount: 50000 },
  { label: "Alumni Network", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", amount: 30000 },
];

// Public read-only RPC the frontend uses on each network (no wallet needed)
const READ_RPC = {
  31337: "http://127.0.0.1:8545",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};

const FRONTEND_SRC = path.join(__dirname, "..", "frontend", "src");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const { chainId } = await hre.ethers.provider.getNetwork();
  console.log(`Network: ${hre.network.name} (chain ID ${chainId})`);
  console.log("Deploying with wallet:", deployer.address);

  // Safety check: make sure the hash really comes from the logo file
  const fileBytes = fs.readFileSync(path.join(__dirname, "..", "alu-logo.png"));
  const fileHash = "0x" + crypto.createHash("sha256").update(fileBytes).digest("hex");
  if (fileHash !== ALU_LOGO_HASH) {
    throw new Error(`alu-logo.png hash (${fileHash}) does not match ALU_LOGO_HASH`);
  }
  console.log("ALU logo SHA-256:", ALU_LOGO_HASH);

  // ---- Deploy the registry and register the logo ----
  const registry = await hre.ethers.deployContract("ALUAssetRegistry");
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("ALUAssetRegistry deployed to:", registryAddress);

  const tx = await registry.registerAsset("ALU Official Logo", "image/png", ALU_LOGO_HASH);
  const receipt = await tx.wait();
  console.log("Logo registered. Tx hash:", receipt.hash);

  const event = receipt.logs
    .map((log) => {
      try { return registry.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e && e.name === "AssetRegistered");
  const tokenId = event.args.tokenId;
  console.log("Logo NFT token ID:", tokenId.toString());

  const [authentic, message] = await registry.verifyLogoIntegrity(tokenId, ALU_LOGO_HASH);
  console.log("Integrity check:", authentic, "-", message);

  // ---- Deploy the ownership token ----
  const token = await hre.ethers.deployContract("ALULogoToken", [deployer.address]);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("ALULogoToken deployed to:", tokenAddress);

  // ---- Give example shares so the dashboard has real holders to show ----
  for (const holder of EXAMPLE_HOLDERS) {
    const t = await token.distributeShares(holder.address, holder.amount);
    await t.wait();
    console.log(`Gave ${holder.amount.toLocaleString()} ALUT to ${holder.label} (${holder.address})`);
  }
  console.log("Owner ALUT balance:", (await token.balanceOf(deployer.address)).toString());
  console.log("Owner share:", (await token.ownershipPercentage(deployer.address)).toString() + "%");

  // ---- Hand the ABIs and addresses to the frontend ----
  writeAbi("ALUAssetRegistry");
  writeAbi("ALULogoToken");

  const configPath = path.join(FRONTEND_SRC, "config", "contracts.json");
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  config[chainId.toString()] = {
    networkName: hre.network.name === "localhost" ? "Hardhat Local" : hre.network.name,
    chainId: Number(chainId),
    rpcUrl: READ_RPC[Number(chainId)] || "",
    registryAddress,
    tokenAddress,
    logoTokenId: Number(tokenId),
    owner: deployer.address,
    exampleHolders: EXAMPLE_HOLDERS.map(({ label, address }) => ({ label, address })),
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Frontend config written to frontend/src/config/contracts.json");
}

// Copies just the ABI from Hardhat's build output into frontend/src/abi
function writeAbi(name) {
  const artifact = hre.artifacts.readArtifactSync(name);
  const out = path.join(FRONTEND_SRC, "abi", `${name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`ABI written to frontend/src/abi/${name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
