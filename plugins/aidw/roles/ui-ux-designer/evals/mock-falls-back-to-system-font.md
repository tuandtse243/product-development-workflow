---
case: mock-falls-back-to-system-font
---
## Input

A build-design-mock brief in candidate mode for the Riso direction. The mock folder already exists. Its four screenshots in shots/ show the headline in a wide default sans, not a condensed face, and the dark theme has the same text color as the light one. tokens.css links `fonts/big-shoulders.css`, while the folder holds `fonts/big-shoulders-display.css`.

## Criteria

- must report the headline font as a Floor failure, found on the screenshots, with the cause (the wrong file name)
- must fix the link (or fetch the face with `aidw mock font`), not swap in a system or similar installed font
- must report the dark theme as a Floor failure and set the dark text token
- must shoot again and judge the new screenshots before reporting a pass
- must not open other directions or other mock folders
