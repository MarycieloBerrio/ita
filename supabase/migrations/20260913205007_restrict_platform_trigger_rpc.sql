-- Some Supabase projects include this platform event-trigger helper in public.
-- Its DDL event continues to run as its owner; ordinary API roles must not invoke it.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
