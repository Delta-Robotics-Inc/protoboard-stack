# Protoboard Stack 0.3 — release notes

0.3 is about the first ten minutes: a Get Started page that opens after the
install, an example drone you can open without an account, and a sign-in that
is one link. The [0.2 release notes](stack-v0.2.md) describe the line before
it.

## 0.3.0

Get Started, the drone example, sign in by link, and Windows fixes.

### Versions

| Package | Version |
| --- | --- |
| `@protoboardai/*` (core, cli, cloud, views, web-viewer and the twelve extensions) | 0.3.0 |
| The VS Code extension (`deltarobotics.vscode-protoboard`) | 0.3.0 |
| `@deltarobotics/uhd-viewer` | 0.2.1 |
| `@deltarobotics/uhd` (pinned by new projects) | 0.3.1 |

The stack's packages depend on each other at `^0.3.0`, and every extension
declares `compatibility.protoboard: "^0.3.0"`.

### Get Started

- **Get Started with Protoboard** opens once, after the first install, in an
  editor tab. Five steps: choose a theme, sign in, connect your agent, open
  the drone example, start your own project. A step is done when it is so on
  your machine, not when you click it. It opens again from **Protoboard: Get
  Started** and from Help in the side bar.
- **The drone example comes with the extension.** **Open the Quadcopter
  Example…** copies a complete 5-inch quadcopter into a folder you choose and
  opens it: diagram, 3D, BOM and documents. It needs no account and no npm.
- **A window with no project** shows the example's card, New Project, and
  what the Library looks like before a sign-in.
- **Connect your agent** lists the agents found on the machine. **Add to
  PATH** is there while the `protoboard` command isn't on your `PATH`.
- **A new project made in another folder** is offered in a dialog that stays:
  Open in New Window, Open Here or Add to Workspace.
- **A stack that can't be set up at the first start** is reported, with Try
  Again and Show Log.

### Sign in by link

- **One link, from any machine.** `protoboard login` and **Sign In** in VS
  Code print and open one link. You sign in on that page, and the terminal or
  the editor continues by itself.
- **A short code when the page can't reach you.** Over SSH, in a remote
  window or on another device, the page shows a code: paste it where you
  started.
- **In VS Code, a prompt instead of a terminal.** Sign In is one prompt at
  the top of the window, with buttons to open the link again and to copy it.
  It closes by itself. **Sign In with a Code** is gone: the same prompt takes
  the code.
- **For agents and scripts:** `protoboard login --start` prints the link, and
  `protoboard login --code <code>` finishes. `--device` still works.
- **A sign-in that can't be saved is a failure**, and says why, in the
  terminal and in the prompt.

### Restricted Mode

- **Protoboard says that it is off, and how to turn it on.** In a folder VS
  Code doesn't trust yet, the views say "Protoboard is off until you trust
  this folder." with **Trust This Folder**, and a project's window shows the
  same in a **Protoboard** tab that stays. Nothing of the project runs until
  you trust it. The example opens this way too, like any new folder.

### Windows

- **`check` and `build` work for a standard user** (no administrator, no
  Developer Mode) on a project whose parts carry their own source, such as
  the drone example. This comes with UHD 0.3.1.
- **Node.js 22.0 to 22.12** run them too, and so does a machine with no
  Node.js installed, where Protoboard runs on the editor's own runtime.
- **Add to PATH** appends its one folder to your user `Path` and leaves the
  rest as it was, `%USERPROFILE%` entries included.
- **`protoboard login` from a PowerShell 7 terminal** saves the sign-in.
- **The `protoboard` command reports its exit code** to PowerShell: a
  command that fails no longer looks like one that worked.

### Upgrading a 0.2 project

A project made with 0.2.x asks for `^0.2.x`, which 0.3.0 is not. One command
moves it, offline:

```sh
cd my-project
git commit -am "Before Protoboard 0.3"     # so the changes can be reviewed
protoboard upgrade --dry-run               # what would change
protoboard upgrade
protoboard check
```

`upgrade` sets every `@protoboardai/*` range to `^0.3.0` and
`@deltarobotics/uhd` to 0.3.1, links the project's packages again and
refreshes `AGENTS.md` with this version's guidance. Nothing in a project's
own sources needs to change.

In VS Code, a project like that offers **Protoboard: Update Project to This
Extension's Protoboard Version**.

A project that still pins UHD 0.3.0 gets a warning from `protoboard check`
(`PB_UHD_PIN`) until `protoboard upgrade` moves the pin.

### Known limits

- **The first sign-in from the sign-in page shows a browser permission
  prompt**, because the page hands the sign-in to a program on your machine.
  Allow it, or type the code the page shows.
- **Google sign-in and macOS** were not exercised by the team before this
  release.
- **With no Node.js installed**, the fix is verified on Linux with the
  editor's runtime, not yet on Windows.
- **The extension is larger**: about 65 MB per platform, 20 MB more than
  0.2.3, for the example it carries.
