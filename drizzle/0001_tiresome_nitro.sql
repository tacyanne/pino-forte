CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`company_name` text DEFAULT 'Pino de Balança' NOT NULL,
	`responsible` text DEFAULT 'Rogério Mendes' NOT NULL,
	`company_phone` text DEFAULT '' NOT NULL,
	`order_footer` text DEFAULT 'Documento gerado pelo sistema Pino de Balança' NOT NULL
);
