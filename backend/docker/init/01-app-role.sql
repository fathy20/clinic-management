-- LOCAL DEVELOPMENT ONLY. Runs once, from docker-entrypoint-initdb.d.
-- Production creates this role out of band and sets its password from the secret store;
-- the migration only grants privileges to it (NFR-SEC-11: no secret in a tracked file).
create role physioflow_app
  login password 'local_dev_only'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
