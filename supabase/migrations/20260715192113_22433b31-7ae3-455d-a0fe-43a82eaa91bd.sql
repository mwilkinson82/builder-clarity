revoke execute on function public.apply_production_sov_certification_to_billing(uuid, uuid)
  from public, anon;

grant execute on function public.apply_production_sov_certification_to_billing(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';