# USOA account portal

The portal uses its own Supabase project. Existing invoice storage, VPIN
verification, and guest checkout continue to use their current settings.

1. Apply the portal schema in a new commerce project. Disable public signup
   in Supabase Auth. Configure verified SMTP for invitations and recovery.
   Allow the staging and production `/portal.html` URLs as Auth redirects.
2. Add the first verified user in Supabase Auth. Using that user's UUID,
   insert a row in `public.portal_profiles` with `role = 'owner'`. Never
   grant owner from the browser. Sign in through `/admin/login` and enrol
   an authenticator before sending an invitation.
3. Configure `PORTAL_SUPABASE_URL` and `PORTAL_SUPABASE_PUBLISHABLE_KEY` on
   the Worker. Set `PORTAL_SUPABASE_SECRET_KEY` as a Worker secret using the
   commerce project's modern Supabase secret key.
4. On staging, verify invitation and password reset, two-customer isolation,
   admin MFA, staff permission changes, private PDF upload and download,
   and Cashfree sandbox checkout through the signed success webhook.
5. Existing purchases and PDFs are not assigned by matching email or phone.
   Import verified legacy ownership explicitly if historical records should
   appear. The existing document verifier is a separate sharing flow.

The browser SDK is the pinned `@supabase/supabase-js@2.119.0` UMD distribution.
