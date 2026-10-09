# Personal data boundaries

- Use fictional sample data for implementation, browser QA, screenshots, and tests.
- Do not read `private/`, `.env*`, generated personal PDFs, or a browser containing real decrypted data.
- Do not ask for personal data or passwords in chat or pass them to shell commands.
- The JSON reading restriction applies only to real encrypted JSON, including `public/profile.enc.json`. Do not read or decrypt it using agent tools. Fictional ciphertext fixtures may be used for encryption tests.
- The user chose to keep education, work history except company names, qualifications, skills, and writing unencrypted in `public/resume-content.json`. Agents may read and directly edit this unencrypted JSON when updating document content at the user's request. Do not introduce draft-import buttons or extra confirmation steps for these edits. Preserve unrelated fields and career IDs. Basic identity, contact details, and company names must remain encrypted. Store company names in the encrypted profile linked to career IDs; legacy plaintext names are removed only after successful encryption in the user's browser.
- Use `examples/resume-content.example.json` and fictional fixtures for implementation QA, browser QA, screenshots, and tests; permission to edit real unencrypted content does not permit displaying it in agent browser tooling.
- Never log, upload, or persist decrypted basic identity, contact details, company names, or passwords. Do not add analytics, external scripts, remote fonts, or remote PDF services.
- These instructions and `.gitignore` are not OS-enforced access controls. Encryption protects stored files; a browser displaying decrypted data must stay outside agent tooling.
- Keep the app local unless the user explicitly requests hosting.
- Read `docs/PLAN.md` for the agreed scope. Verify using dummy data only.

# UI display policy

- Show as little information as possible: display only inputs, actions, and feedback needed for the current task. Do not display unnecessary explanations, duplicate status badges, routine saved-state notices, sample age/education guidance, or implementation file paths.
- Keep secondary actions collapsed under 「その他」. Show saving, unsaved changes, validation errors, and failed-save retry only when relevant; keep automatic saving active without an explanatory card.
- Make inputs discoverable on the document itself. Empty employer fields should say 「会社名を入力」 and be directly editable after unlocking basic information or starting new basic information.
