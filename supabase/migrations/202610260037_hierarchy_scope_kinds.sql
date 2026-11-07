-- Enum values must be committed before the following migration uses them.
alter type public.scope_kind add value if not exists 'division';
alter type public.scope_kind add value if not exists 'company';
