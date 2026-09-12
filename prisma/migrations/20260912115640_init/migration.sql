-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'KITCHEN', 'CASHIER', 'DELIVERY');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('NEW', 'REGULAR', 'LOYAL', 'VIP', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CUSTOMER_CREATED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'ORDER_CONFIRMED', 'ORDER_PREPARING', 'ORDER_READY', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'REVIEW_RECEIVED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "external_id" TEXT,
    "role" "UserRole" NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "whatsapp_number" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "average_order_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "first_order_at" TIMESTAMP(3),
    "last_order_at" TIMESTAMP(3),
    "customer_type" "CustomerType" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "category_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "image_url" TEXT,
    "sku" TEXT,
    "preparation_time" INTEGER,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "external_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "checkout_session_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "delivery_address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "preparing_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name_snapshot" TEXT NOT NULL,
    "unit_price_snapshot" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "order_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payment_method" TEXT,
    "gateway" TEXT,
    "transaction_id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_drivers" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicle" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "assigned_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "customer_name" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "delivery_address" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "status" "CheckoutStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_sessions" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "customer_id" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "last_message_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "whatsapp_number" TEXT NOT NULL,
    "customer_id" TEXT,
    "order_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "message" TEXT NOT NULL,
    "external_message_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "external_event_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "event_types" "EventType"[] DEFAULT ARRAY[]::"EventType"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deliveries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_slug_key" ON "restaurants"("slug");

-- CreateIndex
CREATE INDEX "users_restaurant_id_role_idx" ON "users"("restaurant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_restaurant_id_email_key" ON "users"("restaurant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_restaurant_id_idx" ON "api_keys"("restaurant_id");

-- CreateIndex
CREATE INDEX "customers_restaurant_id_customer_type_idx" ON "customers"("restaurant_id", "customer_type");

-- CreateIndex
CREATE INDEX "customers_restaurant_id_last_order_at_idx" ON "customers"("restaurant_id", "last_order_at");

-- CreateIndex
CREATE INDEX "customers_restaurant_id_created_at_idx" ON "customers"("restaurant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_restaurant_id_whatsapp_number_key" ON "customers"("restaurant_id", "whatsapp_number");

-- CreateIndex
CREATE INDEX "categories_restaurant_id_is_active_idx" ON "categories"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "categories_restaurant_id_name_key" ON "categories"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "products_restaurant_id_category_id_idx" ON "products"("restaurant_id", "category_id");

-- CreateIndex
CREATE INDEX "products_restaurant_id_is_available_idx" ON "products"("restaurant_id", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "products_restaurant_id_sku_key" ON "products"("restaurant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_session_id_key" ON "orders"("checkout_session_id");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_status_idx" ON "orders"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_payment_status_idx" ON "orders"("restaurant_id", "payment_status");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_created_at_idx" ON "orders"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_restaurant_id_order_number_key" ON "orders"("restaurant_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_restaurant_id_idx" ON "order_items"("restaurant_id");

-- CreateIndex
CREATE INDEX "payments_restaurant_id_status_idx" ON "payments"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "payments_restaurant_id_created_at_idx" ON "payments"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_restaurant_id_transaction_id_key" ON "payments"("restaurant_id", "transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_drivers_user_id_key" ON "delivery_drivers"("user_id");

-- CreateIndex
CREATE INDEX "delivery_drivers_restaurant_id_is_active_idx" ON "delivery_drivers"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_restaurant_id_status_idx" ON "deliveries"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "deliveries_driver_id_status_idx" ON "deliveries"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_id_key" ON "reviews"("order_id");

-- CreateIndex
CREATE INDEX "reviews_restaurant_id_rating_idx" ON "reviews"("restaurant_id", "rating");

-- CreateIndex
CREATE INDEX "reviews_restaurant_id_created_at_idx" ON "reviews"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "reviews_customer_id_idx" ON "reviews"("customer_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_restaurant_id_status_idx" ON "checkout_sessions"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "checkout_sessions_restaurant_id_whatsapp_number_idx" ON "checkout_sessions"("restaurant_id", "whatsapp_number");

-- CreateIndex
CREATE INDEX "checkout_sessions_expires_at_idx" ON "checkout_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_restaurant_id_session_id_key" ON "checkout_sessions"("restaurant_id", "session_id");

-- CreateIndex
CREATE INDEX "conversation_sessions_restaurant_id_status_idx" ON "conversation_sessions"("restaurant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_sessions_restaurant_id_whatsapp_number_key" ON "conversation_sessions"("restaurant_id", "whatsapp_number");

-- CreateIndex
CREATE INDEX "messages_restaurant_id_whatsapp_number_created_at_idx" ON "messages"("restaurant_id", "whatsapp_number", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_restaurant_id_external_message_id_key" ON "messages"("restaurant_id", "external_message_id");

-- CreateIndex
CREATE INDEX "events_restaurant_id_status_next_attempt_at_idx" ON "events"("restaurant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "events_restaurant_id_type_created_at_idx" ON "events"("restaurant_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "events_entity_type_entity_id_idx" ON "events"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_restaurant_id_external_event_id_key" ON "events"("restaurant_id", "external_event_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_restaurant_id_is_active_idx" ON "webhook_endpoints"("restaurant_id", "is_active");

-- CreateIndex
CREATE INDEX "event_deliveries_status_next_attempt_at_idx" ON "event_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_deliveries_event_id_endpoint_id_key" ON "event_deliveries"("event_id", "endpoint_id");

-- CreateIndex
CREATE INDEX "audit_logs_restaurant_id_created_at_idx" ON "audit_logs"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_restaurant_id_read_at_idx" ON "notifications"("restaurant_id", "read_at");

-- CreateIndex
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_restaurant_id_scope_key_key" ON "idempotency_records"("restaurant_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_drivers" ADD CONSTRAINT "delivery_drivers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_drivers" ADD CONSTRAINT "delivery_drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "delivery_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
