-- Mentors could INSERT outreach_only bills (insert policy uses has_bills_permission)
-- but INSERT … RETURNING / loadAllBills failed because SELECT still checked members.bills only.

DROP POLICY IF EXISTS "Members with bills permission can select bills" ON public.bills;
CREATE POLICY "Members with bills permission can select bills"
  ON public.bills
  FOR SELECT
  TO authenticated
  USING (public.has_bills_permission());

COMMENT ON POLICY "Members with bills permission can select bills" ON public.bills IS
  'Bills team (members.bills) and active mentor accounts can select bills.';
