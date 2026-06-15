import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const receiverPk = generatePrivateKey();
const receiver = privateKeyToAccount(receiverPk);

const payerPk = generatePrivateKey();
const payer = privateKeyToAccount(payerPk);

console.log("# Receiver / merchant wallet");
console.log(`SERVER_ADDRESS=${receiver.address}`);
console.log("# Receiver private key. Save only if you need to recover test funds; do not put it in .env.");
console.log(`# ${receiverPk}`);
console.log("");
console.log("# Payer / agent wallet");
console.log(`PAYER_ADDRESS=${payer.address}`);
console.log(`CLIENT_TEST_PK=${payerPk}`);
console.log("");
console.log("# Add SERVER_ADDRESS and CLIENT_TEST_PK to .env, then fund PAYER_ADDRESS with Base Sepolia USDC.");
