UPDATE `customers`
SET `customer_type` = 'Distribuidor'
WHERE TRIM(LOWER(`name`)) = TRIM(LOWER('RC Peças Acessórios Para Truck e Carretas'));
--> statement-breakpoint
UPDATE `service_orders`
SET
  `customer_type` = 'Distribuidor',
  `subtotal` = CASE WHEN `subtotal` > 0 THEN `subtotal` ELSE `total` END,
  `discount_rate` = CASE
    WHEN `quantity` >= 20 THEN 10
    WHEN `quantity` >= 10 THEN 8
    ELSE 5
  END,
  `total` = ROUND(
    (CASE WHEN `subtotal` > 0 THEN `subtotal` ELSE `total` END) *
    (CASE
      WHEN `quantity` >= 20 THEN 0.90
      WHEN `quantity` >= 10 THEN 0.92
      ELSE 0.95
    END),
    2
  )
WHERE TRIM(LOWER(`customer_name`)) = TRIM(LOWER('RC Peças Acessórios Para Truck e Carretas'));
