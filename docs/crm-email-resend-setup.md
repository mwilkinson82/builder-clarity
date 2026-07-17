# OverWatch CRM email with Resend

The CRM sends reviewed, one-to-one follow-up from the Follow-Up Studio. Harbor Residence walkthrough addresses ending in `@demo.overwatch.example` are always simulated inside OverWatch; they never call Resend or Lovable email.

## Recommended sender setup

Use a dedicated sending subdomain under the OverWatch marketing domain, such as `send.example.com`, instead of the root marketing domain. This keeps marketing-site DNS and CRM sending reputation easier to manage independently.

In Resend:

1. Add the chosen sending domain.
2. Publish the exact SPF and DKIM records Resend provides at the DNS host.
3. Wait until Resend reports the domain as **Verified**.
4. Choose the visible sender mailbox, for example `followup@send.example.com`.

The user's OverWatch profile email is set as `Reply-To`, so replies return to the person who sent the follow-up.

## Lovable secrets

Add these as server-side secrets in Lovable. Never commit or paste the API key into source code.

```text
RESEND_API_KEY=re_...
CRM_EMAIL_FROM_ADDRESS=followup@send.example.com
CRM_EMAIL_SENDER_DOMAIN=send.example.com
```

`CRM_EMAIL_SENDER_DOMAIN` should match the verified domain containing the From address. When `RESEND_API_KEY` is present, CRM delivery uses Resend. Without it, the existing Lovable email integration remains the fallback.

## Database migration

Lovable must apply:

```text
supabase/migrations/20260717165334_allow_resend_crm_provider.sql
```

Then run:

```text
supabase/verification/20260717165334_allow_resend_crm_provider.sql
```

The verified constraint must allow `lovable_email`, `resend`, and `demo`.

## Acceptance check

1. Restore the Harbor CRM walkthrough and run a demo send. Delivery History must show **Demo delivery** and say no external email was sent.
2. Use a real opportunity with an address you control. Send one reviewed follow-up.
3. Delivery History must show **Resend**, the message must arrive, and Reply must target the sender's OverWatch profile email.
4. Confirm the Resend activity log reports the same recipient and subject.
