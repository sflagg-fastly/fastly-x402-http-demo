import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "node:fs";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const erc20Abi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }]
}];

function loadDotEnv() {
  if (!existsSync(".env")) return {};
  const env = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

const localEnv = loadDotEnv();
const rpcUrl = process.env.EVM_RPC_URL || localEnv.EVM_RPC_URL || "https://sepolia.base.org";

let payer = process.argv[2];
if (!payer) {
  const pk = process.env.CLIENT_TEST_PK || localEnv.CLIENT_TEST_PK;
  if (pk?.startsWith("0x")) payer = privateKeyToAccount(pk).address;
}

if (!payer?.startsWith("0x") || payer.length !== 42) {
  console.error("Usage: npm run balance -- 0xPayerAddress");
  console.error("Or set CLIENT_TEST_PK in .env and run: npm run balance");
  process.exit(1);
}

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

const [eth, usdcBal] = await Promise.all([
  client.getBalance({ address: payer }),
  client.readContract({
    address: USDC_BASE_SEPOLIA,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payer]
  })
]);

console.log(`payer: ${payer}`);
console.log(`Base Sepolia ETH: ${formatUnits(eth, 18)}`);
console.log(`Base Sepolia USDC: ${formatUnits(usdcBal, 6)}`);
console.log("Minimum for this demo: 0.001 Base Sepolia USDC");
