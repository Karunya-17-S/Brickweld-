-- =====================================================================
-- Brickweld ERP — 0005 starting data (safe for production)
-- =====================================================================
INSERT INTO public.company_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

INSERT INTO public.expense_categories (name) VALUES
  ('Fuel & Diesel'), ('Transport'), ('Food & Tea'), ('Site Rent'), ('Electricity & Water'), ('Repairs & Maintenance'),
  ('Tools & Consumables'), ('Machinery Hire'), ('Office Expenses'), ('Salaries (Office)'), ('Permits & Fees'), ('Miscellaneous')
ON CONFLICT DO NOTHING;

INSERT INTO public.job_types (name) VALUES
  ('Centering'), ('Bar Bending'), ('Masonry'), ('Plastering'), ('Electrical'), ('Plumbing'), ('Painting'),
  ('Tiling & Flooring'), ('Fabrication / Grill'), ('Carpentry'), ('Excavation'), ('Waterproofing')
ON CONFLICT DO NOTHING;

INSERT INTO public.materials (name, unit, category) VALUES
  ('Cement OPC 53', 'bag', 'Cement'), ('Cement PPC', 'bag', 'Cement'), ('M-Sand', 'unit', 'Aggregates'),
  ('P-Sand', 'unit', 'Aggregates'), ('20mm Jelly', 'unit', 'Aggregates'), ('40mm Jelly', 'unit', 'Aggregates'),
  ('TMT Steel 8mm', 'kg', 'Steel'), ('TMT Steel 10mm', 'kg', 'Steel'), ('TMT Steel 12mm', 'kg', 'Steel'),
  ('TMT Steel 16mm', 'kg', 'Steel'), ('Binding Wire', 'kg', 'Steel'), ('Red Bricks', 'nos', 'Masonry'),
  ('Solid Blocks 6"', 'nos', 'Masonry'), ('Solid Blocks 4"', 'nos', 'Masonry'), ('Ready Mix Concrete M20', 'cum', 'Concrete')
ON CONFLICT DO NOTHING;

-- Head Office: a location for office staff attendance & office expenses (kept out of site P&L).
INSERT INTO public.projects (code, name, kind, status) VALUES ('HO', 'Head Office', 'office', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO public.money_accounts (name, type, opening_balance) VALUES
  ('Main Bank Account', 'bank', 0), ('Petty Cash', 'petty_cash', 0)
ON CONFLICT DO NOTHING;
