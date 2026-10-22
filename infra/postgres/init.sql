-- Development only. In production the role is created by infrastructure with a secret password.
CREATE ROLE axis_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'axis_app';
