/**
 * Prints where Rocky puts its global directory, in a fresh process.
 *
 * A child rather than an in-process assertion because the default derives from
 * `os.homedir()`, which reads the user database rather than `process.env.HOME`
 * under Bun. A child gets a genuine HOME in its environment, so the answer is
 * the one a user would actually get.
 */
import { getAgentDir } from "@jakeryderv/rocky-harness";

process.stdout.write(`${getAgentDir()}\n`);
