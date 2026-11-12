# USOA account portal

The portal uses its own Supabase project. Existing invoice storage, VPIN
verification, and guest checkout continue to use their current settings.

1. Apply the portal schema in the dedicated commerce project. Enable **Allow new users to sign up**
   in Supabase Auth > General configuration, and enable the email provider's signup option.
   Keep **Confirm Email** enabled, configure verified SMTP for confirmations and recovery,
   and allow the staging and production `/portal.html` URLs as Auth redirects.
   Public customers register themselves from `/login` without an invitation.
2. Add the first verified user in Supabase Auth. Using that user's UUID,
   insert a row in `public.portal_profiles` with `role = 'owner'`. Never
   grant owner from the browser. Sign in through `/admin/login` and enrol
   an authenticator before sending an invitation.
3. Configure `PORTAL_SUPABASE_URL` and `PORTAL_SUPABASE_PUBLISHABLE_KEY` on
   the Worker. Set `PORTAL_SUPABASE_SECRET_KEY` as a Worker secret using the
   commerce project's modern Supabase secret key.
4. On staging, verify invitation and password reset, two-customer isolation,
   admin MFA, staff permission changes, private PDF upload and download,
   and Cashfree sandbox checkout through the signed success webhook. Also test public registration,
   confirmation email, account login, and confirm that newly registered users cannot access `/admin/login`.
5. Existing purchases and PDFs are not assigned by matching email or phone.
   Import verified legacy ownership explicitly if historical records should
   appear. The existing document verifier is a separate sharing flow.

The browser SDK is the pinned `@supabase/supabase-js@2.119.0` UMD distribution.
