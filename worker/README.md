# Photo hazard spotting relay

The app's **✨ Spot hazards** button sends a photo to an AI vision model (Claude) and gets back suggested hazards from your checklist, with a marker for where each one is in the photo. You accept or dismiss each suggestion; nothing is added without you.

The app is a public web page, so the AI key can't live in it. This small relay holds the key for you. It runs free on Cloudflare Workers.

## You need

- An Anthropic API key from <https://console.anthropic.com> (pay-as-you-go; each photo costs roughly a penny or two).
- A free Cloudflare account: <https://dash.cloudflare.com/sign-up>.

## Set it up (about 10 minutes, works from a phone browser)

1. In Cloudflare, go to **Workers & Pages → Create → Create Worker**. Name it e.g. `risk-ai` and press **Deploy**.
2. Press **Edit code**, delete what's there, paste the whole of `worker.js` from this folder, then **Deploy**.
3. Go to the worker's **Settings → Variables and Secrets** and add:
   - `ANTHROPIC_API_KEY` (type **Secret**): your Anthropic key.
   - `ACCESS_CODE` (type **Secret**): any password you choose. This stops strangers using your key.
   - `ALLOWED_ORIGIN` (type **Text**, optional): `https://beanosaur.github.io`
4. Copy the worker's address, e.g. `https://risk-ai.yourname.workers.dev`.
5. In the app, tap **⚙️ → Photo hazard spotting**, paste the address and your access code, and tap **Test connection**.

## Notes

- Photos are sent to the relay and on to Anthropic's API only when you tap **✨ Spot hazards**. Nothing is stored by the relay.
- To use a different Claude model, add a `MODEL` text variable.
- Set a monthly spend limit in the Anthropic console if you want a hard cap.
