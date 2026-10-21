import { parseArgs } from "node:util";
import { reviewAccountClosure } from "../src/account-closure.js";

try {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" }, email: { type: "string" }, project: { type: "string" },
      apply: { type: "boolean", default: false }, "confirm-id": { type: "string" },
      "access-block-verified": { type: "boolean", default: false }, help: { type: "boolean", default: false },
    }, strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log("Operator account review: --user-id UUID --email VERIFIED_EMAIL --project PROJECT_REF\nRead-only by default. Do not pass credentials as command arguments.\nDeletion additionally requires --apply --confirm-id UUID --access-block-verified and the deployed account closure block. Read docs/ACCOUNT-CLOSURE.md first.");
  } else {
    const result = await reviewAccountClosure({
      userId: values["user-id"], email: values.email, expectedProject: values.project,
      apply: values.apply, confirmId: values["confirm-id"], accessBlockVerified: values["access-block-verified"],
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
