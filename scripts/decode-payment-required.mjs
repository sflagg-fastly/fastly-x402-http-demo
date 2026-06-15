const encoded = process.argv[2];

if (!encoded) {
  console.error("Usage: npm run decode:payment-required -- <payment-required-header-value>");
  process.exit(1);
}

try {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  console.log(JSON.stringify(JSON.parse(decoded), null, 2));
} catch (error) {
  console.error("Could not decode header:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
