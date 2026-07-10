-- VENDORS — address for the "Add a new vendor" details window (field request,
-- DB3T 2026-07-10: contact name, address, email, phone "to build them out in
-- the database"). Contact name/email/phone/trade already exist on the table;
-- this adds the one missing field. One free-form line — contractors write
-- "123 Main St, Miami FL 33101", not four normalized columns.
--
-- Idempotent + portable. NOT a hard prereq: saveVendor detects the missing
-- column and saves the vendor without the address until this is applied.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
