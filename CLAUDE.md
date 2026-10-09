# Local Resume

Follow `AGENTS.md`, particularly the personal data boundaries. The JSON reading restriction applies only to real encrypted JSON: never read or decrypt `public/profile.enc.json` using agent tools. Unencrypted `public/resume-content.json` may be read and edited directly for user-requested document updates. Preserve unrelated fields and career IDs. Use fictional data for implementation QA, browser QA, screenshots, and tests. Do not inspect a real unlocked browser, passwords, `private/`, `.env*`, or exported personal PDFs. File ignore rules are not filesystem access controls.
