// Shared dApp logic.
// Everything in here is plain JavaScript with no DOM code, so the same
// functions are used by the web page (src/main.js) AND by the automated
// tests in test/ALUAssetRegistry.test.js.

import { isAddress } from "ethers";

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

// 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -> 0xf39F...2266
export function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// 1000000n -> "1,000,000"  (ALUT has 0 decimals, so 1 token = 1 share)
export function formatTokenAmount(value) {
  return BigInt(value).toLocaleString("en-US");
}

// Unix seconds -> "14 November 2026, 10:32"
export function formatTimestamp(seconds) {
  const date = new Date(Number(seconds) * 1000);
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Part B: in-browser SHA-256 hashing                                  */
/* ------------------------------------------------------------------ */

// Turns raw bytes into a lowercase hex string
function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes a File (or Blob) with the Web Crypto API.
 * The file never leaves the user's computer.
 * Returns the plain hex hash and the bytes32 version for the contract.
 */
export async function hashFile(file) {
  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = bytesToHex(digest);
  return { hex, bytes32: `0x${hex}` };
}

/**
 * Cleans up a hash someone pasted in (spaces, missing 0x, capitals).
 * Returns a valid bytes32 string, or null if it is not a SHA-256 hash.
 */
export function normaliseHash(input) {
  const clean = String(input || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) return null;
  return `0x${clean}`;
}

/* ------------------------------------------------------------------ */
/* Turning blockchain errors into plain English                        */
/* ------------------------------------------------------------------ */

export function friendlyError(error) {
  const text = [
    error?.reason,
    error?.shortMessage,
    error?.info?.error?.message,
    error?.message,
  ]
    .filter(Boolean)
    .join(" ");

  if (error?.code === "ACTION_REJECTED" || error?.info?.error?.code === 4001 || error?.code === 4001) {
    return "You cancelled the transaction in your wallet. Nothing was sent.";
  }
  if (text.includes("already been registered")) {
    return "This file has already been registered. Each logo can only be registered once.";
  }
  if (error?.revert?.name === "OwnableUnauthorizedAccount" || text.includes("OwnableUnauthorizedAccount")) {
    return "Only the ALU logo owner wallet can distribute shares.";
  }
  if (error?.revert?.name === "ERC20InsufficientBalance" || text.includes("ERC20InsufficientBalance")) {
    return "The owner wallet doesn't have enough ALUT for this transfer.";
  }
  if (text.includes("Token does not exist")) {
    return "No logo is registered under that token ID.";
  }
  if (text.includes("could not detect network") || text.includes("ECONNREFUSED") || text.includes("Failed to fetch")) {
    return "Can't reach the blockchain. Make sure the Hardhat node is running.";
  }
  return error?.shortMessage || error?.reason || error?.message || "Something went wrong.";
}

/* ------------------------------------------------------------------ */
/* Part B: registering an asset                                        */
/* ------------------------------------------------------------------ */

/**
 * Calls registerAsset() and waits for it to be mined.
 * The wallet pops up and asks the user to approve before anything is sent.
 * Returns the new token ID read from the AssetRegistered event.
 */
export async function registerLogo(registry, { assetName, fileType, contentHash }) {
  if (!assetName?.trim()) throw new Error("Please enter an asset name.");
  if (!fileType?.trim()) throw new Error("Please enter a file type.");
  const hash = normaliseHash(contentHash);
  if (!hash) throw new Error("The content hash is not a valid SHA-256 hash.");

  // Free read first, so a duplicate gets a clear message before the wallet opens
  if (await registry.isHashRegistered(hash)) {
    throw new Error("This file has already been registered. Each logo can only be registered once.");
  }

  const tx = await registry.registerAsset(assetName.trim(), fileType.trim(), hash);
  const receipt = await tx.wait();

  for (const log of receipt.logs) {
    try {
      const parsed = registry.interface.parseLog(log);
      if (parsed?.name === "AssetRegistered") {
        return { tokenId: parsed.args.tokenId, txHash: receipt.hash };
      }
    } catch {
      // log from another contract (e.g. none here), skip it
    }
  }
  throw new Error("Registered, but the token ID could not be read from the receipt.");
}

/* ------------------------------------------------------------------ */
/* Part C: public verification                                         */
/* ------------------------------------------------------------------ */

/**
 * Builds what the verification page should show, in plain language.
 * No hex strings are shown to the user here.
 */
export function verificationView(isAuthentic, asset) {
  if (isAuthentic) {
    return {
      status: "authentic",
      icon: "✓",
      title: "Logo Verified",
      message: "This is the authentic ALU logo.",
      details: asset
        ? [
            ["Registered as", asset.assetName],
            ["Registered on", formatTimestamp(asset.registeredAt)],
            ["Registered by", `ALU owner wallet (${shortenAddress(asset.registeredBy)})`],
          ]
        : [],
    };
  }
  return {
    status: "fake",
    icon: "!",
    title: "Warning: This logo has been modified",
    message:
      "This file does not match the official ALU logo recorded on the blockchain. Don't trust it or use it.",
    details: [],
  };
}

/**
 * Calls verifyLogoIntegrity() (a free, read-only call) and returns the view.
 * Works with a plain read-only provider, so no wallet is needed.
 */
export async function verifyLogo(registry, tokenId, contentHash) {
  const hash = normaliseHash(contentHash);
  if (!hash) throw new Error("That doesn't look like a SHA-256 hash. It should be 64 letters and numbers.");

  const [isAuthentic, contractMessage] = await registry.verifyLogoIntegrity(tokenId, hash);
  const asset = isAuthentic ? await registry.getAsset(tokenId) : null;
  return { ...verificationView(isAuthentic, asset), contractMessage };
}

// Escapes text before putting it into HTML
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Turns a verification view into the HTML the page displays. */
export function renderVerificationHTML(view) {
  const rows = view.details
    .map(([label, value]) => `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  return `
    <div class="result result--${view.status}" role="status">
      <div class="result__icon" aria-hidden="true">${view.icon}</div>
      <div>
        <h3 class="result__title">${escapeHtml(view.title)}</h3>
        <p class="result__message">${escapeHtml(view.message)}</p>
        ${rows ? `<div class="details">${rows}</div>` : ""}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Part D: token dashboard                                             */
/* ------------------------------------------------------------------ */

export async function readTotalSupply(token) {
  const supply = await token.totalSupply();
  return { value: supply, display: formatTokenAmount(supply) };
}

/** Balance and ownership percentage of one wallet. */
export async function readHolding(token, address) {
  const [balance, percentage] = await Promise.all([token.balanceOf(address), token.ownershipPercentage(address)]);
  return { address, balance, percentage, display: `${formatTokenAmount(balance)} ALUT`, percentDisplay: `${percentage}%` };
}

/** Checks the distribution form before anything is sent to the wallet. */
export function validateDistribution({ recipient, amount, ownerAddress, ownerBalance }) {
  if (!isAddress(recipient || "")) return "Enter a valid wallet address (it starts with 0x and has 42 characters).";
  if (ownerAddress && recipient.toLowerCase() === ownerAddress.toLowerCase()) return "You can't send shares to the owner wallet itself.";
  if (!/^\d+$/.test(String(amount ?? "").trim())) return "Enter a whole number of ALUT tokens.";
  const value = BigInt(String(amount).trim());
  if (value <= 0n) return "The amount must be greater than zero.";
  if (ownerBalance !== undefined && value > BigInt(ownerBalance)) {
    return `The owner only has ${formatTokenAmount(ownerBalance)} ALUT left to give out.`;
  }
  return null; // all good
}

/**
 * Calls distributeShares() and waits for confirmation.
 * Returns the recipient's new balance, read back from the contract.
 */
export async function distributeShares(token, recipient, amount) {
  const tx = await token.distributeShares(recipient, BigInt(amount));
  const receipt = await tx.wait();
  const recipientBalance = await token.balanceOf(recipient);
  return { txHash: receipt.hash, recipientBalance };
}
