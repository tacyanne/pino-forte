DELETE FROM `service_orders`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = 'service_orders';
--> statement-breakpoint
DELETE FROM `customers`
WHERE lower(trim(`name`)) IN (
  'posto de molas londrina',
  'tacyanne pessoa ribeiro'
);
--> statement-breakpoint
DELETE FROM `sqlite_sequence`
WHERE `name` = 'customers'
  AND NOT EXISTS (SELECT 1 FROM `customers`);
