# Changelog

## 0.3.0

- **Get Started with Protoboard** opens after a first install: choose a
  theme, sign in, connect your agent, open the drone example, start a
  project. Each step shows whether it is done.
- **The drone example** is carried by the extension and opens in a folder
  you choose, with no account and no npm.
- A window with no project shows the example's card and what the Library
  looks like before a sign-in.
- **Sign In** is one prompt at the top of the window: it opens one link,
  closes by itself when you have signed in, and takes the code the page
  shows when the browser can't reach this window. Sign In with a Code is
  gone.
- In Restricted Mode the views say that Protoboard is off and offer to
  trust the folder; a project's window shows the same in a tab that stays.
- A new project made in another folder is offered to open in a dialog.
- A stack that cannot be set up at the first start is reported, with Try
  Again.
- Windows: the drone example checks and builds for a standard user;
  **Add to PATH** appends its folder to your user `Path` and leaves the rest
  as it was, `%USERPROFILE%` entries included; the `protoboard` command
  reports its exit code.
- A project made with Protoboard 0.2 is offered a one-step update.

## 0.2.3

- Sign-in works again with the hosted library, and when the service can't check
  a sign-in, the extension says so and keeps you signed in.
- Searches with several words find more parts.
- `views check` skips the Library tab, with the reason, when the library can't
  be used.

## 0.2.2

- A floating hierarchy that folds from its own header, and Harnesses & links
  for the level on screen.
- An Open button on the project card, and modules open in the viewer.
- A loading screen, an empty module's Add a part, and the legend at the
  bottom right with what each colour means.
- The library works in every project, with clearer sign-in messages.
- Help in the side bar, with the Discord community.
- Windows: moving a project to a new stack no longer fails.

## 0.2.1

- A new Marketplace page, with screenshots and a short getting-started guide.

## 0.2.0

The first public release.

- **Hierarchy in every viewer tab**, synced with its canvas, and the
  Inspector beside it following the tab you are in.
- **Inspector cards** for each part's files, checks, connections and
  sourcing, expandable for detail.
- **Right-drag to pan** the canvas; right-click still opens its menu.
- **A legend that folds** into the toolbar when the tab is narrow.
- **Projects made with Protoboard 0.1** are offered a one-step update.
- **Protoboard asks once per project** before running its code.
