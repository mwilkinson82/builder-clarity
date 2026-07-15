-- The handoff function is security definer because it performs one guarded,
-- audited billing mutation across project-scoped tables. Keep the RPC exposed
-- only to signed-in application roles; its auth.uid() and can_manage_project()
-- checks remain the row-level authorization boundary.
revoke execute on function public.apply_production_sov_certification_to_billing(uuid, uuid)
  from public, anon;

grant execute on function public.apply_production_sov_certification_to_billing(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
