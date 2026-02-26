# AGENTS.md - BharatVoice AI Voice Agent for Indian Market

## Project Overview
Building a multilingual AI voice receptionist for Indian small businesses.
Key innovation: Native Hinglish (Hindi-English) and Marathi-Hindi code-mix support.
Architecture: Telephony → ASR → NLP → n8n → TTS

## Tech Stack
- **Backend**: Node.js/TypeScript (Express/Fastify)
- **ASR**: Sarvam AI Shuka (primary), Bhashini (fallback)
- **TTS**: Sarvam Bulbul v3 (Hinglish), Bhashini (Marathi)
- **Automation**: n8n (self-hosted)
- **Database**: PostgreSQL (via Supabase or local)
- **Telephony**: Exotel/Knowlarity APIs
- **Deployment**: Docker, AWS/GCP Mumbai region

## Code Conventions

### File Naming
- Use kebab-case for files: `call-handler.ts`, `hinglish-parser.ts`
- Suffix by type: `.service.ts` for business logic, `.controller.ts` for HTTP handlers, `.types.ts` for interfaces
- Test files: `*.test.ts` alongside source files or in `tests/` folder

### TypeScript Rules
- Strict mode enabled
- No `any` types - use `unknown` with type guards
- Explicit return types on all functions
- Interface names: PascalCase with I prefix (e.g., `ICallContext`)

### Architecture Patterns
- Service-oriented: Each vertical (dental, auto, legal) is a separate service
- Repository pattern for database access
- Dependency injection for testability
- Environment-based configuration

### Code Quality
- ESLint + Prettier configured
- Jest for testing (minimum 70% coverage)
- Winston for logging (structured JSON)
- Never use `console.log` in production code

## Environment Variables
All env vars must start with `BV_` (BharatVoice):
- `BV_SARVAM_API_KEY`
- `BV_EXOTEL_SID`, `BV_EXOTEL_TOKEN`
- `BV_DATABASE_URL`
- `BV_N8N_WEBHOOK_URL`
- `BV_LOG_LEVEL`

## Key Integrations
1. Sarvam AI: https://docs.sarvam.ai
2. Exotel: https://developer.exotel.com
3. n8n: https://docs.n8n.io
4. Bhashini: https://bhashini.gitbook.io

## Development Phases
1. Phase 1: Core telephony + echo bot (Hinglish)
2. Phase 2: Intent classification + n8n integration
3. Phase 3: Dental vertical (appointment booking)
4. Phase 4: Marathi support + Auto vertical
5. Phase 5: Dashboard + Analytics

## Testing Strategy
- Unit tests: Jest with mocked external APIs
- Integration tests: Local Exotel sandbox + Sarvam staging
- Manual testing: Use personal phone numbers

## Context Files
- `docs/CONTEXT.md` - Session summaries (maintain this!)
- `docs/API_REFERENCE.md` - External API docs summary
- `docs/DECISIONS.md` - Architecture decisions with rationale