const args = process.argv.slice(2);
const endpointValue = process.env.FEEDBACK_REPORT_ENDPOINT;
const token = process.env.REPORT_ADMIN_TOKEN;

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/request-feedback-report.mjs [--format markdown|json] [--from YYYY-MM-DD --to YYYY-MM-DD] [--history]"
  );
  process.exitCode = 1;
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? "";
}

if (!endpointValue || !token) {
  usage("FEEDBACK_REPORT_ENDPOINT and REPORT_ADMIN_TOKEN are required.");
} else {
  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    usage("FEEDBACK_REPORT_ENDPOINT must be a valid URL.");
  }

  if (!endpoint) {
    // The validation error was already printed above.
  } else if (endpoint.protocol !== "https:" || endpoint.search || endpoint.hash) {
    usage("FEEDBACK_REPORT_ENDPOINT must be an HTTPS URL without query parameters or fragments.");
  } else if (token.length < 32) {
    usage("REPORT_ADMIN_TOKEN must be at least 32 characters.");
  } else {
    const history = args.includes("--history");
    const format = option("--format") || "markdown";
    const from = option("--from");
    const to = option("--to");
    if (!history && !["markdown", "json"].includes(format)) {
      usage("--format must be markdown or json.");
    } else if ((from === null) !== (to === null)) {
      usage("--from and --to must be specified together.");
    } else {
      const body = history ? { action: "history" } : { action: "generate", format };
      if (!history && from !== null) {
        body.from = from;
        body.to = to;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        console.error(`Report request failed with HTTP ${response.status}.`);
        process.exitCode = 1;
      } else {
        process.stdout.write(await response.text());
        if (format === "json" || history) process.stdout.write("\n");
      }
    }
  }
}
