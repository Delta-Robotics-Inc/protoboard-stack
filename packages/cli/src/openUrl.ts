import { spawn } from 'node:child_process';
import { browserUrlProblem } from '@protoboardai/core';

/** A program and its arguments, started without a shell. */
export interface OpenCommand {
	command: string;
	args: string[];
	/** Windows: the arguments go to the program exactly as written here (no quoting added by Node). */
	verbatim?: boolean;
}

/**
 * How the platform's default browser is given a URL: the command, and one to
 * try when the first cannot be started.
 *
 * Windows: never through `cmd /c start`. cmd reads `&` as the end of the
 * command, so a URL with a query was cut at its first `&` (the sign-in link
 * arrived without its `state` and `service`; first builds review, item 22).
 * `rundll32 url.dll,FileProtocolHandler <url>` hands the rest of its command
 * line to the shell's URL handler with no interpreter in between; PowerShell's
 * `Start-Process` with the URL in single quotes is the fallback. Neither goes
 * through cmd, and a URL has no spaces or quotes for either to trip on (`'`
 * is doubled for PowerShell; a `"` or a space is percent-encoded first).
 */
export function openCommands(url: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): OpenCommand[] {
	if (platform === 'win32') {
		// what a URL may not hold raw anyway: nothing for a command line to split on or to close a quote with
		const safe = url.replace(/[\s"<>^|]/g, (c) => encodeURIComponent(c));
		const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
		return [
			{ command: `${root}\\System32\\rundll32.exe`, args: ['url.dll,FileProtocolHandler', safe], verbatim: true },
			{
				command: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
				args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${safe.replace(/'/g, "''")}'`],
			},
		];
	}
	return [{ command: platform === 'darwin' ? 'open' : 'xdg-open', args: [url] }];
}

/**
 * Hands a URL to the platform's default browser and detaches, so the browser
 * outlives the command that opened it (`protoboard dev --open`, `protoboard
 * login`). Failures are swallowed: the caller prints the URL as well.
 * Only an https page, or an http one on this machine, is handed over
 * (PB-1048): the system's opener runs whatever is registered for a scheme
 * (`file:`, an app's own), so anything else is refused and false returned.
 */
export function openUrl(url: string, run: typeof spawn = spawn): boolean {
	if (browserUrlProblem(url)) return false;
	const [first, ...rest] = openCommands(url);
	const start = (c: OpenCommand, next: OpenCommand[]) => {
		try {
			const child = run(c.command, c.args, {
				detached: true,
				stdio: 'ignore',
				windowsHide: true,
				...(c.verbatim ? { windowsVerbatimArguments: true } : {}),
			});
			child.on('error', () => {
				if (next.length) start(next[0]!, next.slice(1));
			});
			child.unref();
		} catch {
			// Ignore - opening a browser is a convenience, not a requirement.
			if (next.length) start(next[0]!, next.slice(1));
		}
	};
	if (first) start(first, rest);
	return true;
}
