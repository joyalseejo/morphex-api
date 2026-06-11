export const SYSTEM_SCHEMAS = [
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Invoice (GST-compliant Indian invoice)
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'invoice-v1',
    name: 'Invoice',
    description: 'GST-compliant Indian invoice with line items, tax breakdown, and payment terms',
    category: 'finance',
    jsonSchema: {
      type: 'object',
      properties: {
        invoice_number:    { type: 'string',  description: 'Unique invoice identifier, e.g. INV-2024-001' },
        date:              { type: 'string',  description: 'Invoice issue date in ISO 8601 or natural format' },
        due_date:          { type: 'string',  description: 'Payment due date' },
        vendor_name:       { type: 'string',  description: 'Name of the selling business or vendor' },
        vendor_gstin:      { type: 'string',  description: '15-character GST Identification Number of vendor' },
        vendor_address:    { type: 'string',  description: 'Full address of the vendor' },
        customer_name:     { type: 'string',  description: 'Name of the buyer / bill-to party' },
        customer_gstin:    { type: 'string',  description: 'GST Identification Number of customer (if registered)' },
        customer_address:  { type: 'string',  description: 'Full billing/shipping address of the customer' },
        line_items: {
          type: 'array',
          description: 'Individual products or services billed',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string',  description: 'Product or service name and details' },
              hsn_code:    { type: 'string',  description: 'HSN/SAC code for GST classification' },
              quantity:    { type: 'number',  description: 'Quantity of units' },
              unit:        { type: 'string',  description: 'Unit of measurement, e.g. Nos, Kg, Ltrs' },
              unit_price:  { type: 'number',  description: 'Price per unit before tax' },
              amount:      { type: 'number',  description: 'Line total = quantity × unit_price' },
            },
          },
        },
        subtotal:          { type: 'number',  description: 'Sum of all line item amounts before tax' },
        discount:          { type: 'number',  description: 'Total discount applied, if any' },
        taxable_amount:    { type: 'number',  description: 'Amount subject to GST (subtotal minus discount)' },
        cgst_rate:         { type: 'number',  description: 'CGST rate as percentage, e.g. 9 for 9%' },
        cgst_amount:       { type: 'number',  description: 'Central GST amount' },
        sgst_rate:         { type: 'number',  description: 'SGST rate as percentage' },
        sgst_amount:       { type: 'number',  description: 'State GST amount' },
        igst_rate:         { type: 'number',  description: 'IGST rate as percentage (for inter-state supply)' },
        igst_amount:       { type: 'number',  description: 'Integrated GST amount (inter-state only)' },
        total_amount:      { type: 'number',  description: 'Final invoice total including all taxes' },
        payment_terms:     { type: 'string',  description: 'Payment terms, e.g. Net 30, Due on receipt' },
        notes:             { type: 'string',  description: 'Additional notes or terms printed on the invoice' },
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Purchase Order
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'purchase-order-v1',
    name: 'Purchase Order',
    description: 'B2B purchase order with line items, delivery details, and payment terms',
    category: 'procurement',
    jsonSchema: {
      type: 'object',
      properties: {
        po_number:             { type: 'string',  description: 'Purchase order number, e.g. PO-2024-0042' },
        date:                  { type: 'string',  description: 'PO creation date' },
        delivery_date:         { type: 'string',  description: 'Requested delivery date' },
        buyer_name:            { type: 'string',  description: 'Name of the purchasing company or individual' },
        buyer_contact:         { type: 'string',  description: 'Buyer email or phone number' },
        supplier_name:         { type: 'string',  description: 'Name of the supplier or vendor' },
        supplier_contact:      { type: 'string',  description: 'Supplier email or phone number' },
        delivery_address:      { type: 'string',  description: 'Full delivery/ship-to address' },
        items: {
          type: 'array',
          description: 'Ordered items',
          items: {
            type: 'object',
            properties: {
              product_name: { type: 'string',  description: 'Name or description of the product' },
              sku:          { type: 'string',  description: 'Stock-keeping unit or product code' },
              quantity:     { type: 'number',  description: 'Ordered quantity' },
              unit:         { type: 'string',  description: 'Unit of measure, e.g. Pcs, Boxes, Kg' },
              unit_price:   { type: 'number',  description: 'Agreed price per unit' },
              total:        { type: 'number',  description: 'quantity × unit_price' },
            },
          },
        },
        subtotal:              { type: 'number',  description: 'Sum of all item totals' },
        shipping_charges:      { type: 'number',  description: 'Freight or delivery charges' },
        total_amount:          { type: 'number',  description: 'Final PO value including shipping' },
        payment_terms:         { type: 'string',  description: 'Payment terms, e.g. 50% advance, 50% on delivery' },
        special_instructions:  { type: 'string',  description: 'Packaging, labelling, or handling instructions' },
        priority:              { type: 'string',  description: 'Order priority: normal, urgent, critical' },
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Receipt (optimised for photographed receipts / WhatsApp images)
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'receipt-v1',
    name: 'Receipt',
    description: 'Retail/restaurant receipt designed for image inputs — photographed or forwarded via WhatsApp',
    category: 'retail',
    jsonSchema: {
      type: 'object',
      properties: {
        vendor_name:     { type: 'string',  description: 'Shop, restaurant, or store name from the header' },
        vendor_address:  { type: 'string',  description: 'Address printed on the receipt' },
        vendor_phone:    { type: 'string',  description: 'Contact phone number of the vendor' },
        receipt_number:  { type: 'string',  description: 'Bill/receipt/transaction number' },
        date:            { type: 'string',  description: 'Date the receipt was issued' },
        time:            { type: 'string',  description: 'Time of transaction, e.g. 14:35' },
        cashier:         { type: 'string',  description: 'Name or ID of the cashier or operator' },
        items: {
          type: 'array',
          description: 'Line items on the receipt',
          items: {
            type: 'object',
            properties: {
              name:       { type: 'string',  description: 'Item name as printed' },
              quantity:   { type: 'number',  description: 'Quantity purchased' },
              unit_price: { type: 'number',  description: 'Price per unit' },
              total:      { type: 'number',  description: 'Item total = quantity × unit_price' },
            },
          },
        },
        subtotal:        { type: 'number',  description: 'Total before discount and tax' },
        discount:        { type: 'number',  description: 'Discount or coupon amount deducted' },
        tax_rate:        { type: 'number',  description: 'Tax/VAT/GST rate applied as a percentage' },
        tax_amount:      { type: 'number',  description: 'Tax amount in currency' },
        total_amount:    { type: 'number',  description: 'Final amount payable' },
        payment_method:  { type: 'string',  description: 'Cash, UPI, Card, Wallet, etc.' },
        amount_paid:     { type: 'number',  description: 'Amount tendered by customer' },
        change_given:    { type: 'number',  description: 'Change returned to customer' },
        notes:           { type: 'string',  description: 'Any printed notes, offers, or thank-you messages' },
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Support Ticket
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'support-ticket-v1',
    name: 'Support Ticket',
    description: 'Customer support ticket from email, chat, or form submission',
    category: 'support',
    jsonSchema: {
      type: 'object',
      properties: {
        customer_name:         { type: 'string',  description: 'Full name of the customer reporting the issue' },
        customer_email:        { type: 'string',  description: 'Customer email address' },
        customer_phone:        { type: 'string',  description: 'Customer phone or mobile number' },
        account_id:            { type: 'string',  description: 'Customer or subscription account identifier' },
        subject:               { type: 'string',  description: 'Short one-line description of the issue' },
        issue_category:        { type: 'string',  description: 'Category: billing, technical, account, delivery, other' },
        priority:              { type: 'string',  description: 'Inferred priority: low, medium, high, critical' },
        product_affected:      { type: 'string',  description: 'Which product, feature, or module is affected' },
        description:           { type: 'string',  description: 'Full description of the problem as stated by customer' },
        steps_to_reproduce:    { type: 'string',  description: 'Steps the customer took before encountering the issue' },
        expected_behavior:     { type: 'string',  description: 'What the customer expected to happen' },
        actual_behavior:       { type: 'string',  description: 'What actually happened' },
        error_message:         { type: 'string',  description: 'Exact error message or code if mentioned' },
        attachments_mentioned: { type: 'boolean', description: 'Whether the customer mentioned attaching screenshots/logs' },
        contact_preference:    { type: 'string',  description: 'Preferred contact method: email, phone, chat' },
        urgency_reason:        { type: 'string',  description: 'Why the customer considers this urgent, if stated' },
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Lead / Contact (Sales CRM)
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'lead-contact-v1',
    name: 'Lead Contact',
    description: 'Sales lead or prospect contact from email, form, chat, or business card',
    category: 'sales',
    jsonSchema: {
      type: 'object',
      properties: {
        first_name:          { type: 'string',  description: 'First name of the lead' },
        last_name:           { type: 'string',  description: 'Last name or surname' },
        email:               { type: 'string',  description: 'Business or personal email address' },
        phone:               { type: 'string',  description: 'Phone or mobile number including country code' },
        company:             { type: 'string',  description: 'Company or organisation name' },
        job_title:           { type: 'string',  description: 'Job title or designation' },
        company_size:        { type: 'string',  description: 'Company headcount range, e.g. 1-10, 11-50, 51-200, 200+' },
        industry:            { type: 'string',  description: 'Industry vertical, e.g. E-commerce, Healthcare, Finance' },
        location:            { type: 'string',  description: 'City, state, or country of the lead' },
        pain_points: {
          type: 'array',
          description: 'Business problems or challenges the lead mentioned',
          items: { type: 'string' },
        },
        product_interest:    { type: 'string',  description: 'Which product, plan, or feature they are interested in' },
        budget_range:        { type: 'string',  description: 'Indicated budget, e.g. Under $500/mo, $1k-5k/mo' },
        timeline:            { type: 'string',  description: 'When they want to start or decide, e.g. This quarter, ASAP' },
        source:              { type: 'string',  description: 'Lead source: website, referral, LinkedIn, event, cold outreach' },
        notes:               { type: 'string',  description: 'Additional context or notes from the conversation' },
        qualification_score: { type: 'number',  description: 'BANT-based score 0-100 inferred from available information' },
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Shipment / Courier
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'shipment-v1',
    name: 'Shipment',
    description: 'Courier or freight shipment details from waybills, booking confirmations, or tracking messages',
    category: 'logistics',
    jsonSchema: {
      type: 'object',
      properties: {
        tracking_number:     { type: 'string',  description: 'Courier tracking or AWB number' },
        carrier:             { type: 'string',  description: 'Carrier or courier company, e.g. BlueDart, FedEx, Delhivery' },
        service_type:        { type: 'string',  description: 'Service level, e.g. Express, Standard, Same-day' },
        sender_name:         { type: 'string',  description: 'Name of the sender or shipper' },
        sender_address:      { type: 'string',  description: 'Full pickup/origin address' },
        sender_phone:        { type: 'string',  description: 'Sender contact number' },
        recipient_name:      { type: 'string',  description: 'Name of the recipient or consignee' },
        recipient_address:   { type: 'string',  description: 'Full delivery/destination address' },
        recipient_phone:     { type: 'string',  description: 'Recipient contact number' },
        items: {
          type: 'array',
          description: 'Contents of the shipment',
          items: {
            type: 'object',
            properties: {
              description:      { type: 'string',  description: 'Item description' },
              quantity:         { type: 'number',  description: 'Number of units' },
              weight_kg:        { type: 'number',  description: 'Weight in kilograms per unit' },
              declared_value:   { type: 'number',  description: 'Declared value in local currency for insurance/customs' },
            },
          },
        },
        total_weight_kg:     { type: 'number',  description: 'Total shipment weight in kg' },
        dimensions: {
          type: 'object',
          description: 'Package dimensions',
          properties: {
            length: { type: 'number' },
            width:  { type: 'number' },
            height: { type: 'number' },
            unit:   { type: 'string',  description: 'cm or inches' },
          },
        },
        shipping_method:      { type: 'string',  description: 'Air, Surface, Rail, Ocean' },
        estimated_delivery:   { type: 'string',  description: 'Expected delivery date or date range' },
        insurance_value:      { type: 'number',  description: 'Insured value in local currency' },
        special_instructions: { type: 'string',  description: 'Handling instructions, e.g. Keep upright, Temperature sensitive' },
        fragile:              { type: 'boolean', description: 'Whether the package is marked fragile' },
        cod_amount:           { type: 'number',  description: 'Cash-on-delivery amount if applicable' },
      },
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Job Application
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'job-application-v1',
    name: 'Job Application',
    description: 'Job application from email, resume, or online form submission',
    category: 'hr',
    jsonSchema: {
      type: 'object',
      properties: {
        applicant_name:       { type: 'string',  description: 'Full name of the applicant' },
        email:                { type: 'string',  description: 'Applicant email address' },
        phone:                { type: 'string',  description: 'Applicant phone number' },
        location:             { type: 'string',  description: 'Current city or location of the applicant' },
        role_applied:         { type: 'string',  description: 'Job title or role the applicant is applying for' },
        experience_years:     { type: 'number',  description: 'Total years of professional experience' },
        current_company:      { type: 'string',  description: 'Current or most recent employer name' },
        current_role:         { type: 'string',  description: 'Current or most recent job title' },
        current_salary:       { type: 'string',  description: 'Current CTC or salary, as stated by applicant' },
        expected_salary:      { type: 'string',  description: 'Expected CTC or salary package' },
        notice_period:        { type: 'string',  description: 'Notice period, e.g. Immediate, 30 days, 60 days' },
        skills: {
          type: 'array',
          description: 'Technical skills, tools, and technologies mentioned',
          items: { type: 'string' },
        },
        education: {
          type: 'array',
          description: 'Educational qualifications',
          items: {
            type: 'object',
            properties: {
              degree:      { type: 'string',  description: 'Degree or qualification, e.g. B.Tech, MBA, B.Com' },
              institution: { type: 'string',  description: 'Name of college or university' },
              year:        { type: 'number',  description: 'Year of graduation or completion' },
            },
          },
        },
        languages: {
          type: 'array',
          description: 'Languages the applicant speaks or writes',
          items: { type: 'string' },
        },
        availability:          { type: 'string',  description: 'When the applicant can start, e.g. Immediately, After 1 month' },
        references_available:  { type: 'boolean', description: 'Whether the applicant has offered references' },
        cover_letter_summary:  { type: 'string',  description: 'Brief summary of the cover letter or personal statement' },
        portfolio_url:         { type: 'string',  description: 'Link to portfolio, GitHub, LinkedIn, or work samples' },
      },
    },
  },
];
