/**
 * Input validation helpers for elvatis-mcp.
 *
 * All values that reach a shell command (even via SSH) must be validated here
 * before use. The goal is to reject shell metacharacters, leading hyphens
 * (flag injection), and path traversal sequences before they reach any
 * command string.
 *
 * These validators are pure functions with no side-effects so they can be
 * unit-tested without SSH/network access.
 */

/**
 * Validate a Docker container name or ID.
 * Docker names: alphanumerics, hyphens, underscores, dots, forward slashes
 * (for compose project/container pairs like "project_web_1").
 * IDs are hex strings (12 or 64 chars).
 * Rejects leading hyphens, spaces, shell metacharacters, and ".." traversal.
 */
export function validateContainerName(value: string): string {
  if (!value || value.length === 0) throw new Error('Container name must not be empty.');
  if (value.length > 128) throw new Error('Container name too long (max 128 chars).');
  // Must start with alphanumeric (not a hyphen / flag prefix).
  // Allowed body: alphanumeric, hyphen, underscore, dot, forward slash.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_./:]*$/.test(value)) {
    throw new Error(
      `Invalid container name "${value}". Only alphanumerics, hyphens, underscores, dots, ` +
      'forward slashes, and colons are allowed. The name must start with an alphanumeric character.',
    );
  }
  if (value.includes('..')) throw new Error('Container name must not contain "..".');
  return value;
}

/**
 * Validate an openclaw delivery channel.
 *
 * The zod schema declares this free-form (`z.string()`), and its description
 * naming whatsapp/telegram/last is documentation rather than a constraint. The
 * value reaches a shell command through `sshExec`, so it is validated here like
 * every other such value, per this module's opening contract.
 *
 * Deliberately an allow-list of the channel-identifier shape rather than a hard
 * enum of the three documented names: openclaw may gain channels, and a rule
 * that has to be edited for each one gets widened under pressure. A leading
 * hyphen is refused so a value cannot smuggle in another flag.
 */
export function validateChannel(value: string): string {
  if (!value || value.length === 0) throw new Error('Channel must not be empty.');
  if (value.length > 64) throw new Error('Channel too long (max 64 chars).');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_.]*$/.test(value)) {
    throw new Error(
      `Invalid channel "${value}". Only alphanumerics, hyphens, underscores, and dots ` +
      'are allowed, and the channel must start with an alphanumeric character.',
    );
  }
  return value;
}

/**
 * Validate a systemd service name.
 * systemctl accepts names like "nginx", "postgresql", "my-service@1.service".
 * Rejects leading hyphens and shell metacharacters.
 */
export function validateServiceName(value: string): string {
  if (!value || value.length === 0) throw new Error('Service name must not be empty.');
  if (value.length > 128) throw new Error('Service name too long (max 128 chars).');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_.@:]*$/.test(value)) {
    throw new Error(
      `Invalid service name "${value}". Only alphanumerics, hyphens, underscores, dots, ` +
      'at-signs, and colons are allowed. The name must start with an alphanumeric character.',
    );
  }
  return value;
}

/**
 * Validate an OpenClaw agent name.
 * Expected values: short lowercase words like "ops", "trading", "default".
 * Rejects anything with spaces, shell metacharacters, or a leading hyphen.
 */
export function validateAgentName(value: string): string {
  if (!value || value.length === 0) throw new Error('Agent name must not be empty.');
  if (value.length > 64) throw new Error('Agent name too long (max 64 chars).');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/.test(value)) {
    throw new Error(
      `Invalid agent name "${value}". Only alphanumerics, hyphens, and underscores are ` +
      'allowed. The name must start with an alphanumeric character.',
    );
  }
  return value;
}

/**
 * Validate a cron schedule value passed to --at or --every flags.
 * Accepts:
 *   --every: "30m", "6h", "1d" (number + unit)
 *   --at: ISO-8601 timestamp "2026-04-01T14:00:00", "+20m" relative offset
 * Rejects anything with shell metacharacters, spaces (except inside a
 * well-formed value), leading hyphens, or traversal sequences.
 *
 * The leading-character rule is separate from the character allow-list on
 * purpose. Every documented form starts with a digit, a letter, or a plus
 * ("30m", "2026-04-01T14:00:00", "+20m"), so a leading hyphen is never a
 * legitimate schedule; it is a flag. This value is the one place on the
 * `openclaw cron add` command line that reaches the remote shell as a bare
 * token, so a value the remote CLI reads as another flag is argument
 * injection even though no shell metacharacter is involved. Every sibling
 * validator in this module already refuses a leading hyphen, and this
 * module's own header names that as the contract; this one did not.
 */
export function validateScheduleValue(value: string): string {
  if (!value || value.length === 0) throw new Error('Schedule value must not be empty.');
  if (value.length > 64) throw new Error('Schedule value too long (max 64 chars).');
  // Allow: alphanumerics, hyphens, colons, dots, plus, underscores, slashes.
  // This covers ISO timestamps, relative offsets (+20m), and interval specs.
  if (!/^[a-zA-Z0-9+][a-zA-Z0-9\-:.+_/]*$/.test(value)) {
    throw new Error(
      `Invalid schedule value "${value}". Only alphanumerics, hyphens, colons, dots, ` +
      'plus signs, underscores, and forward slashes are allowed, and the value must ' +
      'start with an alphanumeric character or a plus sign.',
    );
  }
  if (value.includes('..')) throw new Error('Schedule value must not contain "..".');
  return value;
}

/**
 * Validate a deploy service name used in openclaw_deploy.
 * These names become part of script filenames on the remote server, e.g.
 * deploy-{service}.sh and logs/{service}.log. Only lowercase and uppercase
 * alphanumeric characters, hyphens, and underscores are allowed so that
 * user input cannot traverse paths or inject shell syntax.
 */
export function validateDeployService(value: string): string {
  if (!value || value.length === 0) throw new Error('Deploy service name must not be empty.');
  if (value.length > 64) throw new Error('Deploy service name too long (max 64 chars).');
  // Must start with alphanumeric (not a hyphen / flag prefix).
  // Allowed body: alphanumeric, hyphen, underscore only (no dots, slashes, or
  // metacharacters that could affect path construction or shell parsing).
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/.test(value)) {
    throw new Error(
      `Invalid deploy service name "${value}". Only alphanumerics, hyphens, and underscores ` +
      'are allowed. The name must start with an alphanumeric character.',
    );
  }
  if (value.includes('..')) throw new Error('Deploy service name must not contain "..".');
  return value;
}

/**
 * Validate a UUID-format cron job ID (used in cron delete/history).
 * Accepts the standard 8-4-4-4-12 hex format.
 */
export function validateCronId(value: string): string {
  if (!value || value.length === 0) throw new Error('Cron job ID must not be empty.');
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new Error(
      `Invalid cron job ID "${value}". Expected a UUID (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890").`,
    );
  }
  return value;
}

/**
 * Single-quote-escape a string for safe embedding in a POSIX shell command.
 * The resulting string is wrapped in single quotes. Any embedded single quotes
 * are escaped by ending the quote, inserting a literal single quote, then
 * restarting the quote.
 *
 * This is a last-resort helper for paths and messages that must be passed to
 * the remote shell as a single token. Prefer argument arrays (execFileSync)
 * where possible; use this only where the SSH transport forces a command string.
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
