# Groq Test Setup

Groq is an optional server-side provider for customer assistant answers and
owner inventory recommendations. Human support chat and local inventory
summaries continue working when Groq is disabled or unavailable.

## Create and configure a test key

1. Create a GroqCloud project and API key in the Groq console.
2. Open the ignored local file `server/.env`.
3. Add:

   ```env
   ENABLE_GROQ=true
   GROQ_API_KEY=your_test_key
   GROQ_MODEL=openai/gpt-oss-20b
   ```

4. Keep `ENABLE_OPENAI=false` while Groq is the selected provider.
5. Restart the website server.
6. Confirm that **Groq AI assistance** is marked **Ready** in Owner Settings.

Never place the Groq key in `client/.env`, a `VITE_` variable, browser code,
Firebase records, screenshots, commits, or chat messages. Replacing the test
account later requires changing only `GROQ_API_KEY` in the server environment.

## Behavior and safety limits

- Customer questions are answered from a bounded public menu context.
- Customer messages are still copied to the staff support inbox so a person can reply.
- The assistant must defer when supplied data cannot answer a question.
- Inventory requests send aggregate sales and product stock fields only.
- Names, phone numbers, addresses, delivery pins, payment references, and supplier
  details are excluded from inventory AI requests.
- Groq can recommend actions but cannot modify inventory, prices, orders, or availability.
- The owner must review every recommendation.
- Free-tier limits can change and are not a production availability guarantee.

## Disable immediately

Set `ENABLE_GROQ=false` and restart the server. The website returns to its local
assistant fallback and deterministic inventory summary without losing messages,
orders, or inventory records.
