# Requirements Document

## Introduction

This feature covers three changes to "Quiet Square", a browser-based chess analysis web app built with Vite (version 8) today, chess.js, the Stockfish engine, onnxruntime-web, and the @mliebelt/pgn-parser library. The application source currently lives in `src/` and is written entirely in JavaScript, with build and asset scripts in `scripts/` (`prepare-assets.mjs`, `build-opening-sample.mjs`) and the bundler configured by `vite.config.js`. The app is a client-side single-page app with Web Workers, WebAssembly engine files, and an onnxruntime-web model.

The first change adds real-time feedback while a PGN import is parsing. Today, `src/pgn.worker.js` (a Web Worker) parses the entire PGN text at once and posts a single final message back to `src/main.js`, which shows a static "Loading games…" message for the whole wait. This feature replaces that static message with a live, incremental "Parsed X / N games…" counter and a progress indicator that updates as the worker reports progress during parsing.

The second change migrates the whole codebase from JavaScript to TypeScript: every file under `src/`, both Web Workers, `vite.config.js`, and the scripts under `scripts/`, with a new `tsconfig.json` and a build-time type-check step.

The third change moves the app from Vite to Next.js (App Router) in TypeScript, so that it deploys on Vercel as a Next.js project. The page remains a client-rendered app: Next.js provides routing, the build, the dev server, and response headers.

The following assumptions were made by the orchestrator and are flagged here so the user can override them at review:

- **TypeScript strict mode is ON.** The user did not specify a strictness level. Strict mode is chosen as the sensible default for a fresh migration. This is an overridable assumption.
- **The migration is behavior-preserving.** The only new runtime behavior introduced is the real-time PGN parse feedback from Requirement 1. No other features change.
- **Next.js (App Router, latest stable) replaces Vite as the framework and bundler.** Vite and its config are removed. The `dev`, `build`, and `start` commands replace `dev`, `build`, and `preview`.
- **The app UI stays client-rendered.** The chess UI, workers, engine, and model run only in the browser, so the main page is a Client Component with no server-side data fetching. Server-side rendering is limited to the page shell.
- **Static assets stay in `public/`**, including piece SVGs, the engine and model files, and the bundled opening data.

## Glossary

- **App**: The Quiet Square chess web application, running in a browser.
- **PGN**: Portable Game Notation, the text format for recorded chess games that the App imports.
- **PGN_Import**: The operation of loading one or more games from a PGN source (a pasted string or a selected file) into the App.
- **Parse_Worker**: The Web Worker (`pgn.worker`) that reads a PGN source, validates each game, and reports results to the main thread.
- **Vision_Worker**: The Web Worker (`vision.worker`) that runs board-image recognition.
- **Main_Thread**: The application code (`main`) that spawns the Parse_Worker, renders UI, and handles worker messages.
- **Progress_Message**: A message the Parse_Worker posts to the Main_Thread while parsing, carrying the running count of games processed and the total game count.
- **Progress_Counter**: The live, on-screen text the Main_Thread renders from Progress_Messages, in the form "Parsed X / N games…".
- **Progress_Indicator**: The visual element that shows how far the PGN_Import has progressed toward completion.
- **Final_Summary**: The message the App shows when PGN_Import finishes, stating the number of games loaded and, if any were skipped, the number skipped.
- **Game_Picker**: The selection control that lists the loaded games and lets the user open one.
- **Size_Cap**: The maximum accepted PGN source size of 5 megabytes.
- **Game_Cap**: The maximum accepted number of games in one PGN_Import, 1,000 games.
- **Parse_Timeout**: The 30-second limit after which an unfinished PGN_Import is abandoned with an error.
- **TypeScript**: The typed superset of JavaScript that the codebase is migrated to.
- **TS_Config**: The `tsconfig.json` file that configures the TypeScript compiler for the project.
- **Strict_Mode**: The TypeScript compiler setting that enables the full family of strict type-checking options.
- **Type_Check**: A compile-time pass that reports TypeScript type errors without emitting JavaScript output.
- **Build_Pipeline**: The sequence of commands run for `dev`, `build`, and `start`, including the pre-build asset step.

## Requirements

### Requirement 1: Live PGN Parse Progress

**User Story:** As a player importing games, I want to watch the PGN parse in real time, so that I know the app is working and how far along it is instead of staring at a static message.

#### Acceptance Criteria

1. WHILE a PGN_Import is in progress, THE App SHALL display a Progress_Counter in the form "Parsed X / N games…", where X is the number of games processed so far and N is the total number of games detected in the source, in place of a single static loading message.
2. WHILE a PGN_Import is in progress, THE App SHALL display a Progress_Indicator that reflects the proportion of games processed (X of N) and updates as X increases.
3. WHEN the Parse_Worker finishes processing each game or batch of games, THE Parse_Worker SHALL post a Progress_Message to the Main_Thread carrying the running processed-game count and the total game count.
4. WHEN the Main_Thread receives a Progress_Message, THE App SHALL update the Progress_Counter and Progress_Indicator to the values in that message within 200 milliseconds, without reloading the page.
5. WHILE a PGN_Import is in progress, THE App SHALL update the processed-game count so that it is non-decreasing and never exceeds the total game count N.
6. WHEN a PGN_Import completes successfully, THE App SHALL replace the Progress_Counter and Progress_Indicator with the Final_Summary, stating the number of games loaded, and SHALL state the number of skipped games when one or more games were skipped.
7. WHEN a PGN_Import completes successfully, THE App SHALL populate the Game_Picker with the loaded games and open the first game, with the same result as the existing behavior before this feature.
8. THE App SHALL render the Progress_Counter inside an ARIA live region with a politeness setting of "polite", so that a screen reader announces progress updates without interrupting the user, and SHALL expose the Final_Summary text to assistive technology through the same region.
9. IF the PGN source exceeds the Size_Cap, THEN THE App SHALL reject the PGN_Import, display an error message indicating the source is too large, and SHALL NOT display the Progress_Counter or Progress_Indicator.
10. IF the PGN source contains more than the Game_Cap number of games, THEN THE Parse_Worker SHALL stop the PGN_Import and report an error indicating the game limit was exceeded, and THE App SHALL display that error in place of the Progress_Counter.
11. IF a PGN_Import does not complete within the Parse_Timeout, THEN THE App SHALL abandon the PGN_Import, terminate the Parse_Worker, and display an error message indicating the import took too long, leaving any previously loaded games and the Game_Picker unchanged.
12. IF the Parse_Worker reports a parse error or fails to start, THEN THE App SHALL display the corresponding error message in place of the Progress_Counter and Progress_Indicator, and SHALL leave any previously loaded games and the Game_Picker unchanged.
13. IF a PGN_Import yields no complete, legal, standard-chess game, THEN THE App SHALL display an error message indicating that no loadable game was found, and SHALL NOT populate the Game_Picker.

### Requirement 2: Full TypeScript Migration of the Codebase

**User Story:** As a maintainer, I want the entire codebase written in TypeScript, so that type errors are caught before runtime and the code is easier to maintain.

#### Acceptance Criteria

1. THE App SHALL contain a TypeScript source file for every application module currently under `src/` (`crop`, `engine`, `game`, `history-view`, `icons`, `main`, `outcomes`, `pgn.worker`, `position`, `source-tabs`, `vision.worker`), and SHALL contain no application JavaScript source file under `src/` after the migration.
2. THE App SHALL implement both the Parse_Worker and the Vision_Worker as TypeScript source files.
3. THE Build_Pipeline SHALL use a TypeScript Next.js configuration file (`next.config.ts`) in place of `vite.config.js`, and SHALL remove Vite and its dependency from the project.
4. THE Build_Pipeline scripts under `scripts/` (`prepare-assets` and `build-opening-sample`) SHALL be TypeScript source files after the migration.
5. THE App SHALL include a TS_Config at the project root that applies to all TypeScript source files in the project.
6. THE TS_Config SHALL enable Strict_Mode. (Assumption: Strict_Mode is enabled by default; the user may override this at review.)
7. THE App SHALL update every import specifier that refers to a migrated module so that each import resolves to its migrated module under the TypeScript and Vite setup, with no unresolved import remaining.
8. THE App SHALL provide type declarations for every third-party dependency used in the TypeScript source (chess.js, @mliebelt/pgn-parser, onnxruntime-web, and stockfish), either from an installed types package or from a project-local declaration, so that no module import used in the source is untyped.

### Requirement 3: Build-Time Type Checking

**User Story:** As a maintainer, I want the build to fail on type errors, so that broken types never reach a release build.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL run a Type_Check that reports TypeScript type errors without emitting JavaScript output.
2. WHEN the project build command runs, THE Build_Pipeline SHALL run the Type_Check as part of the build.
3. IF the Type_Check reports one or more type errors, THEN THE Build_Pipeline SHALL fail the build with a non-zero exit status and SHALL report the errors, and SHALL NOT produce a release build output.
4. WHEN the Type_Check reports no type errors, THE Build_Pipeline SHALL continue the build and produce the release build output.
5. THE Build_Pipeline SHALL keep the `dev`, `build`, and `start` commands operable after the migration, each producing the same observable result as before the migration except for the added Type_Check and the live parse feedback from Requirement 1.
6. THE Build_Pipeline SHALL keep the existing pre-build asset-preparation step running before the build output is produced.

### Requirement 4: Behavior Preservation After Migration

**User Story:** As a player, I want the app to behave exactly as it did before, so that the migration does not change how I use it, apart from the new live parse feedback.

#### Acceptance Criteria

1. THE App SHALL preserve every user-facing behavior that existed before this feature, except for the live PGN parse feedback defined in Requirement 1, which is the only intended behavior change.
2. THE App SHALL preserve the Size_Cap, the Game_Cap, and the Parse_Timeout with the same limits and the same resulting behavior as before the migration.
3. THE App SHALL preserve the existing error messages and error conditions for PGN_Import, so that the same error condition produces an equivalent message to the user.
4. THE App SHALL preserve the Game_Picker behavior, listing loaded games in the same order and opening the first game on a successful PGN_Import.
5. WHEN the App loads and runs in a browser after the migration, THE App SHALL produce the same board, analysis, PGN import, and board-recognition behavior that it produced before the migration, with no feature removed.

### Requirement 5: Outlined Game-Results Bars

**User Story:** As a user reading opening statistics, I want the White/Draw/Black result bars drawn as colored outlines with the panel background showing through, so that the table looks lighter and less heavy than solid-filled pills.

#### Acceptance Criteria

1. THE App SHALL render each game-results bar segment (White, Draw, Black) with a colored border in its semantic color (green for White, neutral for Draw, red for Black) rather than a solid color fill.
2. THE App SHALL render the interior of each game-results bar segment in the surrounding panel/page background color, so that no solid accent fill appears inside the segment.
3. THE App SHALL render each segment's percentage label text in the segment's semantic accent color, with contrast against the background meeting WCAG 2.2 AA for normal text.
4. THE App SHALL keep each segment's width proportional to its percentage, so that the White/Draw/Black proportions remain readable from the segment sizes.
5. THE App SHALL apply the outlined bar style in both the dark theme and the light theme, with the interior following the active theme's background color.
6. THE App SHALL apply the outlined style to every place game-results bars appear, including the opening-statistics table and the engine win/draw/loss display.
7. THE App SHALL preserve the existing accessible description of each bar (the role and the "White X%, Draw Y%, Black Z%" summary) after the restyle.

### Requirement 6: Vercel Deployment on chess.advay.ca

**User Story:** As the owner, I want the app deployed to Vercel and served at chess.advay.ca, so that others can use it at a stable custom URL.

#### Acceptance Criteria

1. THE project SHALL include a Vercel deployment configuration committed to the repository that builds the app with the Next.js build (including the pre-build asset step) and serves it as a Next.js project.
2. THE Vercel deployment configuration SHALL set the required cross-origin isolation response headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`) for served pages, set through `next.config.ts` so that the dev server and production serve the same headers, so that the engine and recognition workers run in production.
3. THE project SHALL include written deployment instructions covering connecting the GitHub repository to Vercel, the build command and output directory, adding `chess.advay.ca` as a custom domain, and the exact DNS record to create for `chess.advay.ca`.
4. WHEN the deployment is live, THE App SHALL be reachable at `https://chess.advay.ca` over HTTPS and SHALL serve the production build.
5. THE deployment process SHALL be performed by the owner using the instructions and committed configuration, since account access and DNS changes require the owner's credentials.
6. THE Vercel deployment configuration SHALL serve the production build with behavior equivalent to the local `next start` output, with no application feature removed.

### Requirement 7: Game Review Import from PGN, Chess.com, and Lichess

**User Story:** As a player, I want to load a game by pasting PGN, choosing a file, or pasting a Chess.com or Lichess game link, so that I can review it without copying notation by hand.

#### Acceptance Criteria

1. THE App SHALL offer a review import control that accepts pasted PGN text, a PGN file, a Chess.com game URL, and a Lichess game URL.
2. THE App SHALL show the Chess.com logo on the Chess.com import option and the Lichess logo on the Lichess import option, and SHALL credit both marks in `public/licenses.html`.
3. WHEN the user submits a Lichess game URL, THE App SHALL fetch the game PGN from Lichess in the browser and load it as a PGN_Import.
4. WHEN the user submits a Chess.com game URL, THE App SHALL fetch the game from Chess.com in the browser and load it as a PGN_Import.
5. IF a Chess.com or Lichess request fails, is blocked by the browser, or returns no game, THEN THE App SHALL display an error that names the site and tells the user to paste the PGN instead, and SHALL leave any loaded games unchanged.
6. IF the submitted URL is not a recognizable Chess.com or Lichess game URL, THEN THE App SHALL display an error stating which URL forms are supported.
7. THE App SHALL send no game data to any server other than the Chess.com or Lichess request the user started.

### Requirement 8: Full-Game Engine Review

**User Story:** As a player, I want Stockfish to analyze every position in my game, so that I can see where I played well or badly.

#### Acceptance Criteria

1. WHEN the user starts a review, THE App SHALL evaluate every position of the loaded game with Stockfish and store the evaluation and best move for each position.
2. WHILE a review is running, THE App SHALL display a live progress count in the form "Analyzed X / N moves" and SHALL let the user cancel the review.
3. WHILE a review is running, THE App SHALL keep the board and move list responsive and SHALL let the user step through moves that have already been analyzed.
4. THE App SHALL run the review in a Web Worker so that the main thread is not blocked.
5. IF the engine fails to load or crashes during a review, THEN THE App SHALL display an error and keep the results gathered so far.

### Requirement 9: Move Classification

**User Story:** As a player, I want each move labeled by quality, so that I can see my mistakes at a glance.

#### Acceptance Criteria

1. THE App SHALL assign every reviewed move one label from Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Blunder, and Miss.
2. THE App SHALL derive Best, Excellent, Good, Inaccuracy, Mistake, and Blunder from the drop in win probability between the engine's best move and the move played, using fixed thresholds defined in the design.
3. THE App SHALL label a move Miss WHEN the opponent's previous move was a Mistake or Blunder and the player's move gave up most of the resulting advantage.
4. THE App SHALL label a move Brilliant WHEN the move is a near-best piece sacrifice that leaves the player in a winning or equal position, and Great WHEN the move is the only move that keeps the position from worsening sharply.
5. THE App SHALL show the label with an icon and color next to each move in the move list and on the board for the selected move.
6. THE App SHALL show a count of each label per side in a review summary.

### Requirement 10: Accuracy and Estimated Game Rating

**User Story:** As a player, I want an accuracy score and an estimated rating for the game, so that I can compare games.

#### Acceptance Criteria

1. THE App SHALL compute an accuracy percentage from 0 to 100 for each side, based on how closely that side's moves matched the engine's best choices, and SHALL show a perfect game as 100.
2. THE App SHALL compute an estimated game rating for each side from the accuracy score, and SHALL show it as an estimate.
3. THE App SHALL show a short note that the estimate is based on the game and can differ from the player's usual rating.
4. WHEN a game has fewer than four moves for a side, THE App SHALL hide that side's estimated rating.

### Requirement 11: Evaluation Graph

**User Story:** As a player, I want a chart of who was ahead during the game, so that I can find the turning points.

#### Acceptance Criteria

1. THE App SHALL draw an evaluation graph of the position score after each move from White's perspective.
2. THE App SHALL mark moves labeled Mistake, Blunder, Miss, Brilliant, and Great on the graph.
3. WHEN the user clicks or taps a point on the graph, THE App SHALL jump the board and move list to that move.
4. THE App SHALL highlight the currently selected move on the graph.
5. THE App SHALL expose the graph to assistive technology with a text summary and keyboard-operable move navigation.

### Requirement 12: Move Navigation and Key Moments

**User Story:** As a player, I want to step through the game like the Chess.com analysis board, and jump between the moments that decided it.

#### Acceptance Criteria

1. THE App SHALL provide first, previous, next, and last move controls, and SHALL support the left and right arrow keys, Home, and End.
2. THE App SHALL identify key moments as the moves with the largest swing in win probability, and SHALL list them in game order.
3. WHEN the user selects the key-moment Next control, THE App SHALL jump to the next key moment after the current move, and WHEN there is none, SHALL disable the control.
4. THE App SHALL provide a matching Previous key-moment control.
5. WHEN the user is on a move, THE App SHALL show the engine's suggested best move for that position, with an arrow on the board and the move in text.
6. THE App SHALL let the user turn the suggestion arrow on and off.

### Requirement 13: Coach

**User Story:** As a player, I want plain explanations of why each move was good or bad.

#### Acceptance Criteria

1. THE App SHALL show a short explanation for the selected move that states its label, what it changed in the evaluation, and the better move when one exists.
2. WHERE the browser supports speech synthesis, THE App SHALL offer a control that reads the explanation aloud, and SHALL let the user stop it.
3. WHERE the user is in guess mode (Requirement 15), WHEN the user plays a move other than the game move, THE App SHALL tell the user how that move compares with the played move and the engine's best move.
4. THE App SHALL generate all explanations in the browser from the stored engine results, with no network request.

### Requirement 14: Opening Detection

**User Story:** As a player, I want to know which opening I played and when I left known theory.

#### Acceptance Criteria

1. THE App SHALL show the name and ECO code of the opening for the loaded game, using a bundled opening dataset.
2. THE App SHALL mark the last move that is still in the dataset and the first move that leaves it.
3. IF no opening matches, THEN THE App SHALL show "No named opening".

### Requirement 15: Retry and Self Analysis

**User Story:** As a player, I want to retry a critical position and explore my own ideas with engine feedback.

#### Acceptance Criteria

1. WHEN the user selects Retry on a Mistake, Blunder, or Miss, THE App SHALL return the board to the position before that move and let the user play a different move.
2. WHEN the user plays a retry move, THE App SHALL show its label and evaluation compared with the best move, and SHALL offer to try again or return to the game.
3. THE App SHALL provide Self Analysis, which lets the user play moves from any position as a variation and shows the engine evaluation and label for each move.
4. WHEN the user leaves Self Analysis, THE App SHALL restore the original game line unchanged.

### Requirement 16: Review Settings

**User Story:** As a player, I want to choose whose moves are reviewed and adjust display preferences.

#### Acceptance Criteria

1. THE App SHALL provide a settings control, shown as a gear icon, that opens review settings.
2. THE App SHALL let the user review as White, Black, or both, and SHALL limit labels, accuracy, and key moments to the chosen side.
3. THE App SHALL let the user turn the suggestion arrow, coach audio, and move-label icons on or off.
4. THE App SHALL save these settings on the device and restore them on the next visit.

### Requirement 17: App Name and Page Title

**User Story:** As the owner, I want the app named "Chess Engine" instead of "Quiet Square".

#### Acceptance Criteria

1. THE App SHALL use "Chess Engine" as the page title, in the visible heading, in `public/licenses.html`, and in the README.
2. THE App SHALL update the page description meta tag to describe the app as a chess game review and analysis tool.

### Requirement 18: README Overview and GitHub Domain

**User Story:** As a visitor to the repository, I want a short explanation of how the review works, and a link to the live site.

#### Acceptance Criteria

1. THE README SHALL include a short section, no longer than about 200 words, that explains the review pipeline in order: import, move replay, Stockfish evaluation, win-probability conversion, move classification, accuracy, and key moments.
2. THE README SHALL be written in plain language, without marketing wording.
3. WHEN the site is live, THE owner SHALL set the GitHub repository website to `https://chess.advay.ca`, and THE README SHALL link to it.

### Requirement 19: Next.js Framework

**User Story:** As the owner, I want the app built with Next.js in TypeScript, so that it deploys to Vercel as a standard Next.js project.

#### Acceptance Criteria

1. THE App SHALL use the Next.js App Router with a root layout and a single page, both written in TypeScript.
2. THE App SHALL render the chess UI in a Client Component, and SHALL load the Parse_Worker, Vision_Worker, and engine workers only in the browser.
3. THE App SHALL serve the engine, model, piece, and opening files from `public/` with the correct MIME types, including `application/wasm`.
4. THE App SHALL set the cross-origin isolation headers for all routes through `next.config.ts`.
5. THE project SHALL remove Vite, `vite.config.js`, and the root `index.html` after the move.
