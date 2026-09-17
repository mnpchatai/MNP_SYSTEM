-- Align the pilot approver with the Maintenance request type so the same test
-- account can complete both the manager and owning-department approval steps.
-- This only updates the seeded pilot employee and leaves real accounts intact.
update public.employees
set department_id = '10000000-0000-0000-0000-000000000002'
where employee_no = 'MNP0101'
  and email = 'mnp0101@pilot.mnp.local';
