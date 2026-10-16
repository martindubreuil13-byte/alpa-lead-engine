-- A read-only fingerprint of the public schema's structure (no data). Run it in production (read-only) and in a database built from
-- supabase/test-env/schema.sql: every row must match. Each hash covers names, types, defaults, definitions and order-independent content.
select 'tables' as part, count(*)::text as value from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
union all select 'columns', md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), '|' order by c.relname, a.attname))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
union all select 'constraints', md5(string_agg(cl.relname || '.' || co.conname || ':' || pg_get_constraintdef(co.oid), '|' order by cl.relname, co.conname))
  from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public'
union all select 'indexes', md5(string_agg(pg_get_indexdef(i.indexrelid), '|' order by c.relname, ic.relname))
  from pg_index i join pg_class c on c.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
union all select 'functions', md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')
union all select 'triggers', md5(string_agg(pg_get_triggerdef(t.oid), '|' order by t.tgname))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public', 'auth')
union all select 'rls', md5(string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text, '|' order by c.relname))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
union all select 'policies', md5(string_agg(p.tablename || '.' || p.policyname || ':' || p.permissive || ':' || p.cmd || ':' || array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), '|' order by p.tablename, p.policyname))
  from pg_policies p where p.schemaname = 'public'
union all select 'table_grants', md5(string_agg(c.relname || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type, '|' order by c.relname, a.grantee, a.privilege_type))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relkind in ('r', 'S') and a.grantee <> c.relowner and a.grantee <> 0 and a.privilege_type <> 'MAINTAIN'
order by 1;
