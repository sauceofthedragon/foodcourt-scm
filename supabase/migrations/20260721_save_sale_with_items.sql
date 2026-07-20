-- 2026-07-21 実行済み（SQL Editorで直接実行、記録用）
-- 再実行は冪等（create or replace）
-- 注意: menu_group からの写像は使わない。menu_items.category を正とする

create or replace function save_sale_with_items(
  p_sale_id      uuid,
  p_date         date,
  p_time         time,
  p_discount     numeric,
  p_pay_method   text,
  p_table_no     text,
  p_notes        text,
  p_lunch_count  integer,
  p_dinner_count integer,
  p_customer_id  uuid,
  p_user_id      uuid,
  p_items        jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_sale_id  uuid;
  v_subtotal numeric;
  v_amount   numeric;
  v_category text;
  v_is_new   boolean := (p_sale_id is null);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '明細が空です';
  end if;

  select coalesce(sum((e->>'subtotal')::numeric), 0)
    into v_subtotal
  from jsonb_array_elements(p_items) e;

  v_amount := v_subtotal - coalesce(p_discount, 0);

  select coalesce(m.category, 'その他')
    into v_category
  from jsonb_array_elements(p_items) e
  left join menu_items m
    on m.id = nullif(e->>'menu_item_id','')::uuid
  group by 1
  order by sum((e->>'subtotal')::numeric) desc
  limit 1;

  if v_is_new then
    insert into sales (
      date, time, amount, discount, pay_method, category,
      table_no, notes, lunch_count, dinner_count,
      customer_id, user_id
    ) values (
      p_date, p_time, v_amount, coalesce(p_discount,0), p_pay_method, v_category,
      p_table_no, p_notes, p_lunch_count, p_dinner_count,
      p_customer_id, p_user_id
    )
    returning id into v_sale_id;
  else
    update sales set
      date         = p_date,
      time         = p_time,
      amount       = v_amount,
      discount     = coalesce(p_discount,0),
      pay_method   = p_pay_method,
      category     = v_category,
      table_no     = p_table_no,
      notes        = p_notes,
      lunch_count  = p_lunch_count,
      dinner_count = p_dinner_count,
      customer_id  = p_customer_id
    where id = p_sale_id
    returning id into v_sale_id;

    if v_sale_id is null then
      raise exception '対象の売上が見つかりません: %', p_sale_id;
    end if;

    delete from sale_items where sale_id = v_sale_id;
  end if;

  insert into sale_items (
    sale_id, menu_item_id, item_name, qty, unit_price, unit_cost, subtotal
  )
  select
    v_sale_id,
    nullif(e->>'menu_item_id','')::uuid,
    e->>'item_name',
    (e->>'qty')::numeric,
    (e->>'unit_price')::numeric,
    nullif(e->>'unit_cost','')::numeric,
    (e->>'subtotal')::numeric
  from jsonb_array_elements(p_items) e;

  if v_is_new and p_customer_id is not null then
    perform increment_visit_count(p_customer_id);
  end if;

  return v_sale_id;
end $$;