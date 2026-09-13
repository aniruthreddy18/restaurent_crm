import { requirePermission, toContext } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listCategories, listProducts } from "@/server/modules/menu/menu.service";
import { listProductsSchema } from "@/server/modules/menu/menu.schema";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { AvailabilityToggle } from "@/components/menu/availability-toggle";
import {
  AddCategoryButton,
  AddProductButton,
  EditProductButton,
} from "@/components/menu/product-form";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/table-tools";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu · Restaurant CRM" };

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("menu:read");
  const ctx = toContext(user);
  const query = listProductsSchema.parse(await searchParams);

  const [categories, products] = await Promise.all([listCategories(ctx), listProducts(ctx, query)]);
  const canToggle = can(user.role, "menu:availability");
  const canWrite = can(user.role, "menu:write");
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
      <PageHeader
        title="Menu"
        description="The CRM's copy of the menu. Orders keep their own snapshot of every name and price, so editing here never rewrites past orders."
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <AddCategoryButton />
              <AddProductButton categories={categoryOptions} />
            </div>
          ) : undefined
        }
      />

      {categories.length > 0 ? (
        <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {categories.map((category) => (
            <div key={category.id} className="card px-4 py-3">
              <p className="text-sm font-medium text-ink">{category.name}</p>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {category._count.products} item{category._count.products === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <Card>
        <CardHeader
          title={`${products.meta.total} product${products.meta.total === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                name="categoryId"
                label="Category"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
              <FilterSelect
                name="available"
                label="Availability"
                options={[
                  { value: "true", label: "Available" },
                  { value: "false", label: "Sold out" },
                ]}
              />
              <SearchInput placeholder="Product or SKU" />
            </div>
          }
        />

        {products.data.length === 0 ? (
          <EmptyState
            title={products.meta.total === 0 ? "Your menu is empty" : "No products match"}
            description={
              products.meta.total === 0
                ? canWrite
                  ? "Add a category first if you want to group things, then add your products. Orders already work without a menu — order lines keep their own name and price."
                  : "Nobody has added products yet."
                : "Try clearing the filters."
            }
            action={canWrite && products.meta.total === 0 ? <AddProductButton categories={categoryOptions} /> : undefined}
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>Product</Th>
                    <Th>Category</Th>
                    <Th>SKU</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Prep time</Th>
                    <Th>Available</Th>
                    {canWrite ? <Th /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.data.map((product) => (
                    <tr key={product.id} className="hover:bg-surface-muted">
                      <Td>
                        <span className="font-medium">{product.name}</span>
                        {product.description ? (
                          <p className="max-w-sm truncate text-xs text-ink-subtle">{product.description}</p>
                        ) : null}
                      </Td>
                      <Td className="text-ink-muted">{product.category?.name ?? "—"}</Td>
                      <Td className="tabular-nums text-ink-muted">{product.sku ?? "—"}</Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatMoney(product.price, user.currency)}
                      </Td>
                      <Td className="text-right tabular-nums text-ink-muted">
                        {product.preparationTime ? `${product.preparationTime} min` : "—"}
                      </Td>
                      <Td>
                        <AvailabilityToggle
                          productId={product.id}
                          name={product.name}
                          available={product.isAvailable}
                          disabled={!canToggle}
                        />
                      </Td>
                      {canWrite ? (
                        <Td className="text-right">
                          <EditProductButton
                            categories={categoryOptions}
                            product={{
                              id: product.id,
                              name: product.name,
                              description: product.description,
                              price: product.price.toString(),
                              sku: product.sku,
                              preparationTime: product.preparationTime,
                              categoryId: product.categoryId,
                              isAvailable: product.isAvailable,
                            }}
                          />
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={products.meta.page} pageSize={products.meta.pageSize} total={products.meta.total} />
          </>
        )}
      </Card>
    </>
  );
}
