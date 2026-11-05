# KBH Night Store

Dark hostel snack storefront with a Supabase-backed admin panel. Admins manage products, pickup location, store availability, cash and UPI payment options, and orders. Customers can place cash-at-pickup or UPI orders; UPI opens the customer's payment app with the server-calculated total.

## First-time setup

Follow [supabase/SETUP.md](supabase/SETUP.md) to configure the database, approve an admin, and deploy the order Edge Function.

## Run locally

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and public anon key.
3. Start the app: `npm run dev`.
4. Open the public storefront at `/` or admin panel at `/#admin`.

Never put a Supabase service-role key in the frontend. Orders are validated and created by the server-side `create-order` function. UPI payments remain pending until an admin verifies and marks them paid.
