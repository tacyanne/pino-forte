ALTER TABLE `customers` ADD `customer_type` text DEFAULT 'Cliente final' NOT NULL;
--> statement-breakpoint
ALTER TABLE `service_orders` ADD `subtotal` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `service_orders` ADD `discount_rate` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `service_orders` SET `subtotal` = `total` WHERE `subtotal` = 0;
