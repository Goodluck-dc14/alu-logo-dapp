// ALU Logo Registry dApp: page logic.
// Talks to ALUAssetRegistry and ALULogoToken with ethers.js.
//  - Reads (free) go through a read-only JSON-RPC provider, so no wallet is needed.
//  - Writes (registerAsset, distributeShares) go through the user's wallet,
//    which asks them to approve and sign each transaction.

import "./style.css";
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import registryAbi from "./abi/ALUAssetRegistry.json";
import tokenAbi from "./abi/ALULogoToken.json";
import allConfigs from "./config/contracts.json";
import {
  shortenAddress,
  formatTokenAmount,
  hashFile,
  normaliseHash,
  friendlyError,
  registerLogo,
  verifyLogo,
  renderVerificationHTML,
  readTotalSupply,
  readHolding,
  validateDistribution,
  distributeShares,
} from "./lib/dapp.js";

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

// Which network the app expects (31337 = Hardhat local). Override with VITE_CHAIN_ID.
const CHAIN_ID = String(import.meta.env.VITE_CHAIN_ID || "31337");
const cfg = allConfigs[CHAIN_ID];

const $ = (id) => document.getElementById(id);

const state = {
  account: null, // connected wallet address
  signer: null, // lets us send transactions from that wallet
  onRightNetwork: false,
  owner: null, // ALULogoToken owner
};

// Read-only provider + contracts. These work with no wallet at all.
let readProvider, readRegistry, readToken;
if (cfg) {
  readProvider = new JsonRpcProvider(cfg.rpcUrl, Number(CHAIN_ID), { staticNetwork: true });
  readRegistry = new Contract(cfg.registryAddress, registryAbi, readProvider);
  readToken = new Contract(cfg.tokenAddress, tokenAbi, readProvider);
}

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

function showBanner(html, tone = "info") {
  const banner = $("banner");
  banner.className = `banner banner--${tone}`;
  banner.innerHTML = `<div class="banner__inner">${html}</div>`;
  banner.hidden = false;
}
function hideBanner() {
  $("banner").hidden = true;
}

function setStatus(el, tone, text) {
  el.innerHTML = text ? `<div class="notice notice--${tone}">${text}</div>` : "";
}

function storage(action, key, value) {
  try {
    if (action === "get") return localStorage.getItem(key);
    if (action === "set") localStorage.setItem(key, value);
    if (action === "remove") localStorage.removeItem(key);
  } catch {
    // storage blocked (private window etc.), not important
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Page switching (#verify, #register, #dashboard)                      */
/* ------------------------------------------------------------------ */

function showPage() {
  const route = (location.hash || "#verify").slice(1);
  const page = ["verify", "register", "dashboard"].includes(route) ? route : "verify";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.page !== page));
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("is-active", a.dataset.route === page));
  if (page === "dashboard") refreshDashboard();
}
window.addEventListener("hashchange", showPage);

/* ------------------------------------------------------------------ */
/* Part A2: check both contracts can be read                           */
/* ------------------------------------------------------------------ */

async function checkContracts() {
  if (!cfg) {
    $("contracts-status").textContent = `No contracts found for chain ${CHAIN_ID}. Run the deploy script first.`;
    showBanner(`The contracts haven't been deployed for this network yet. Run <code>npx hardhat run scripts/deploy.js --network localhost</code> and refresh.`, "warn");
    return false;
  }
  try {
    const [registered, regName, tokenName, symbol, owner] = await Promise.all([
      readRegistry.totalRegistered(),
      readRegistry.name(),
      readToken.name(),
      readToken.symbol(),
      readToken.owner(),
    ]);
    state.owner = owner;
    $("contracts-status").innerHTML =
      `<span class="dot dot--ok"></span>${cfg.networkName}: ${regName} (${registered} registered) · ${tokenName} (${symbol})`;
    return true;
  } catch (err) {
    $("contracts-status").innerHTML = `<span class="dot dot--bad"></span>${friendlyError(err)}`;
    showBanner(`Can't reach the contracts. Make sure <code>npx hardhat node</code> is running and you've run the deploy script.`, "warn");
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Part A1: wallet connection                                          */
/* ------------------------------------------------------------------ */

function walletInstalled() {
  return typeof window.ethereum !== "undefined";
}

function noWalletMessage() {
  showBanner(
    `No Web3 wallet found. Install <a href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a> (or Coinbase Wallet) to register logos or manage shares. You can still use <a href="#verify">Verify a Logo</a> without a wallet.`,
    "warn"
  );
}

async function connectWallet() {
  if (!walletInstalled()) return noWalletMessage();
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    storage("remove", "alu-disconnected");
    await loadWallet();
  } catch (err) {
    showBanner(err?.code === 4001 ? "You closed the wallet request. Click Connect Wallet to try again." : friendlyError(err), "warn");
  }
}

// Reads the current account and network from the wallet and updates the page
async function loadWallet() {
  if (!walletInstalled()) return;
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts.length || storage("get", "alu-disconnected")) {
    return setDisconnected();
  }

  // A different account was picked in the wallet, so clear old messages
  if (state.account && accounts[0].toLowerCase() !== state.account.toLowerCase()) {
    $("distribute-status").innerHTML = "";
    $("register-status").innerHTML = "";
  }

  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  state.signer = await provider.getSigner();
  state.account = await state.signer.getAddress();
  state.onRightNetwork = network.chainId.toString() === CHAIN_ID;

  if (!state.onRightNetwork) {
    showBanner(
      `Your wallet is on the wrong network (chain ${network.chainId}). This app uses <strong>${cfg?.networkName || "chain " + CHAIN_ID}</strong>. <button class="btn btn--small" id="switch-btn">Switch network</button>`,
      "warn"
    );
    $("switch-btn").onclick = switchNetwork;
  } else {
    hideBanner();
  }
  await renderWallet();
  updateRegisterButton();
  refreshDashboard();
}

function setDisconnected() {
  state.account = null;
  state.signer = null;
  state.onRightNetwork = false;
  $("wallet-area").innerHTML = `<button class="btn btn--primary" id="connect-btn">Connect Wallet</button>`;
  $("connect-btn").onclick = connectWallet;
  updateRegisterButton();
  refreshDashboard();
}

async function renderWallet() {
  let balanceText = "";
  if (state.onRightNetwork && readToken) {
    try {
      balanceText = `${formatTokenAmount(await readToken.balanceOf(state.account))} ALUT`;
    } catch {
      balanceText = "";
    }
  }
  $("wallet-area").innerHTML = `
    <div class="wallet-chip" title="${state.account}">
      <span class="dot ${state.onRightNetwork ? "dot--ok" : "dot--bad"}"></span>
      <span class="wallet-chip__addr">${shortenAddress(state.account)}</span>
      ${balanceText ? `<span class="wallet-chip__bal">${balanceText}</span>` : ""}
    </div>
    <button class="btn btn--ghost btn--small" id="disconnect-btn">Disconnect</button>`;
  $("disconnect-btn").onclick = disconnectWallet;
}

async function disconnectWallet() {
  storage("set", "alu-disconnected", "1");
  try {
    // Newer wallets let a site give back its permission
    await window.ethereum.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // not supported by every wallet, the local flag is enough
  }
  setDisconnected();
}

async function switchNetwork() {
  const hexId = "0x" + Number(CHAIN_ID).toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if (err?.code === 4902 && cfg) {
      // Wallet doesn't know this network yet, so add it
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hexId, chainName: cfg.networkName, rpcUrls: [cfg.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
      });
    } else {
      showBanner(friendlyError(err), "warn");
    }
  }
}

// Contract instance connected to the wallet (used for transactions)
function writable(kind) {
  if (!state.signer || !state.onRightNetwork) return null;
  return kind === "registry"
    ? new Contract(cfg.registryAddress, registryAbi, state.signer)
    : new Contract(cfg.tokenAddress, tokenAbi, state.signer);
}

/* ------------------------------------------------------------------ */
/* File picker helper (used on Verify and Register)                    */
/* ------------------------------------------------------------------ */

function setupDropzone(zoneId, inputId, previewId, onFile) {
  const zone = $(zoneId);
  const input = $(inputId);
  const preview = $(previewId);

  const handle = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }
    const img = preview.querySelector("img");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(file); // preview so the user can confirm the file
    preview.hidden = false;
    zone.classList.add("has-file");
    onFile(file);
  };

  input.addEventListener("change", () => handle(input.files[0]));
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-over");
    handle(e.dataTransfer.files[0]);
  });
}

/* ------------------------------------------------------------------ */
/* Part C: public verification page                                    */
/* ------------------------------------------------------------------ */

async function runVerification(hash) {
  const out = $("verify-result");
  if (!cfg) return setStatus(out, "error", "The app isn't connected to any contracts yet.");
  out.innerHTML = `<div class="notice notice--info">Checking the blockchain...</div>`;
  try {
    const view = await verifyLogo(readRegistry, cfg.logoTokenId, hash);
    out.innerHTML = renderVerificationHTML(view);
  } catch (err) {
    setStatus(out, "error", friendlyError(err));
  }
}

function setupVerifyPage() {
  if (cfg) $("verify-target").textContent = `Compared against the official ALU logo (registered as token #${cfg.logoTokenId}).`;

  setupDropzone("verify-drop", "verify-file", "verify-preview", async (file) => {
    const { bytes32 } = await hashFile(file); // hashed in the browser, file never uploaded
    runVerification(bytes32);
  });

  $("verify-hash-btn").addEventListener("click", () => {
    const hash = normaliseHash($("verify-hash-input").value);
    if (!hash) {
      return setStatus($("verify-result"), "error", "That doesn't look like a valid fingerprint. It should be 64 letters and numbers.");
    }
    runVerification(hash);
  });
  $("verify-hash-input").addEventListener("keydown", (e) => e.key === "Enter" && $("verify-hash-btn").click());

  document.querySelectorAll(".segmented__btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".segmented__btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      $("verify-file-mode").hidden = btn.dataset.mode !== "file";
      $("verify-hash-mode").hidden = btn.dataset.mode !== "hash";
      $("verify-result").innerHTML = "";
    })
  );
}

/* ------------------------------------------------------------------ */
/* Part B: hash and register                                           */
/* ------------------------------------------------------------------ */

function fileTypeLabel(file) {
  const fromMime = file.type.split("/")[1];
  const fromName = file.name.split(".").pop();
  return (fromMime || fromName || "").replace("svg+xml", "svg").toUpperCase();
}

function updateRegisterButton() {
  const btn = $("reg-submit");
  if (!state.account) btn.textContent = "Connect wallet to register";
  else if (!state.onRightNetwork) btn.textContent = "Switch network to register";
  else btn.textContent = "Register on blockchain";
}

function setupRegisterPage() {
  setupDropzone("register-drop", "register-file", "register-preview", async (file) => {
    const { hex, bytes32 } = await hashFile(file);
    $("hash-filename").textContent = `${file.name} (${file.size.toLocaleString()} bytes)`;
    $("hash-hex").textContent = hex;
    $("hash-bytes32").textContent = bytes32;
    $("hashbox").hidden = false;
    $("reg-hash").value = bytes32; // pre-fill the form
    if (!$("reg-type").value) $("reg-type").value = fileTypeLabel(file);
    setStatus($("register-status"), "", "");
  });

  $("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("register-status");
    if (!state.account) return connectWallet();
    if (!state.onRightNetwork) return switchNetwork();

    const registry = writable("registry");
    const btn = $("reg-submit");
    btn.disabled = true;
    setStatus(status, "info", "Please approve the transaction in your wallet...");
    try {
      const result = await registerLogo(registry, {
        assetName: $("reg-name").value,
        fileType: $("reg-type").value,
        contentHash: $("reg-hash").value,
      });
      setStatus(
        status,
        "success",
        `<strong>Registered!</strong> Your logo is now NFT token <strong>#${result.tokenId}</strong>.<br><span class="mono small">Tx: ${shortenAddress(result.txHash)}</span>`
      );
      checkContracts();
    } catch (err) {
      setStatus(status, "error", friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Part D: token dashboard                                             */
/* ------------------------------------------------------------------ */

async function refreshDashboard() {
  if (!cfg || $("page-dashboard").hidden) return;
  try {
    const supply = await readTotalSupply(readToken);
    $("stat-supply").textContent = `${supply.display} ALUT`;

    // Connected wallet's own numbers
    if (state.account && state.onRightNetwork) {
      const mine = await readHolding(readToken, state.account);
      $("stat-balance").textContent = mine.display;
      $("stat-percent").textContent = mine.percentDisplay;
    } else {
      $("stat-balance").textContent = state.account ? "Wrong network" : "Connect wallet";
      $("stat-percent").textContent = "-";
    }

    // Owner + example holders + anyone who has ever received ALUT (from Transfer events)
    const owner = state.owner || (await readToken.owner());
    const rows = [{ label: "ALU (logo owner)", address: owner }, ...cfg.exampleHolders];
    const known = (addr) => rows.some((r) => r.address.toLowerCase() === addr.toLowerCase());
    try {
      const transfers = await readToken.queryFilter(readToken.filters.Transfer());
      for (const t of transfers) {
        const to = t.args.to;
        if (to !== ZeroAddress && !known(to)) rows.push({ label: "Stakeholder", address: to });
      }
    } catch {
      // some public RPCs limit event searches; the configured list is still shown
    }
    if (state.account && !known(state.account)) rows.push({ label: "You", address: state.account });
    const holdings = await Promise.all(rows.map((r) => readHolding(readToken, r.address)));
    $("holders-body").innerHTML = rows
      .map((r, i) => {
        const h = holdings[i];
        const isMe = state.account && r.address.toLowerCase() === state.account.toLowerCase();
        return `<tr class="${isMe ? "is-me" : ""}">
          <td>${r.label}${isMe ? ' <span class="tag">you</span>' : ""}</td>
          <td class="mono" title="${r.address}">${shortenAddress(r.address)}</td>
          <td class="num">${formatTokenAmount(h.balance)}</td>
          <td class="num"><div class="bar"><i style="width:${Math.max(Number(h.percentage), h.balance > 0n ? 1 : 0)}%"></i></div>${h.percentDisplay}</td>
        </tr>`;
      })
      .join("");

    updateDistributeForm(owner);
  } catch (err) {
    $("holders-body").innerHTML = `<tr><td colspan="4">${friendlyError(err)}</td></tr>`;
  }
}

// Only the owner wallet gets a working form
function updateDistributeForm(owner) {
  const fields = $("distribute-fields");
  const note = $("distribute-note");
  const isOwner = state.account && state.onRightNetwork && state.account.toLowerCase() === owner.toLowerCase();

  if (!state.account) {
    fields.disabled = true;
    note.innerHTML = "Connect the logo owner's wallet to give out ALUT shares.";
  } else if (!isOwner) {
    fields.disabled = true;
    note.innerHTML = `<span class="notice notice--error inline">Only the ALU logo owner can distribute shares. You're connected as ${shortenAddress(state.account)}, which isn't the owner.</span>`;
  } else {
    fields.disabled = false;
    note.textContent = "You're connected as the logo owner. Send ALUT shares to a stakeholder.";
  }
}

function setupDashboard() {
  $("distribute-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("distribute-status");
    const recipient = $("dist-recipient").value.trim();
    const amount = $("dist-amount").value.trim();

    const ownerBalance = await readToken.balanceOf(state.account);
    const problem = validateDistribution({ recipient, amount, ownerAddress: state.account, ownerBalance });
    if (problem) return setStatus(status, "error", problem);

    const btn = $("dist-submit");
    btn.disabled = true;
    setStatus(status, "info", "Please approve the transaction in your wallet...");
    try {
      const result = await distributeShares(writable("token"), recipient, amount);
      setStatus(
        status,
        "success",
        `<strong>Done!</strong> Sent ${formatTokenAmount(amount)} ALUT. ${shortenAddress(recipient)} now holds ${formatTokenAmount(result.recipientBalance)} ALUT.`
      );
      $("dist-amount").value = "";
      await refreshDashboard();
      await renderWallet();
    } catch (err) {
      setStatus(status, "error", friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function start() {
  $("connect-btn").onclick = connectWallet;
  setupVerifyPage();
  setupRegisterPage();
  setupDashboard();
  updateRegisterButton();
  showPage();

  await checkContracts();

  if (walletInstalled()) {
    // React when the user switches account, disconnects or changes network
    window.ethereum.on?.("accountsChanged", () => loadWallet());
    window.ethereum.on?.("chainChanged", () => loadWallet());
    await loadWallet();
  }
  refreshDashboard();
}

start();
