import nodemailer from "nodemailer"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { leadIds, templateId } = await req.json()

    if (!leadIds || !templateId) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 })
    }

    // 1️⃣ Fetch template
    const { data: template } = await admin
      .from("email_templates")
      .select("subject, body")
      .eq("id", templateId)
      .single()

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    // 2️⃣ Fetch leads
    const { data: leads } = await admin
      .from("leads")
      .select("id, company_name, email")
      .in("id", leadIds)

    if (!leads || leads.length === 0) {
      return NextResponse.json({ error: "No leads found" }, { status: 404 })
    }

    // 3️⃣ Setup SMTP
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    // 4️⃣ Send emails using template
    for (const lead of leads) {
      const personalizedBody = template.body.replace(
        "{{company}}",
        lead.company_name || "votre entreprise"
      )

      await transporter.sendMail({
        from: `"Martin Dubreuil" <${process.env.SMTP_USER}>`,
        to: lead.email,
        subject: template.subject,
        html: personalizedBody,
      })
    }

    // 5️⃣ Update status
    await admin
      .from("leads")
      .update({ status: "contacted" })
      .in("id", leadIds)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("send-email error:", error)
    return NextResponse.json({ error: "Failed to send emails" }, { status: 500 })
  }
}