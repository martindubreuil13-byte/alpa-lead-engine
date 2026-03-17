import nodemailer from "nodemailer"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { buildSignatureHtml } from "@/lib/email/buildSignatureHtml"

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type RequestBody = {
  leadIds?: string[]
  subject?: string
  body?: string
  templateId?: string
}

export async function POST(req: Request) {
  try {
    const payload: RequestBody = await req.json()
    const { leadIds, templateId } = payload

    if (!leadIds || leadIds.length === 0) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 })
    }

    // 1️⃣ Resolve subject/body
    let emailSubject = payload.subject || ""
    let emailBody = payload.body || ""

    if ((!emailSubject || !emailBody) && templateId) {
      const { data: template } = await admin
        .from("email_templates")
        .select("subject, body")
        .eq("id", templateId)
        .single()

      if (!template) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 })
      }

      emailSubject = template.subject || ""
      emailBody = template.body || ""
    }

    if (!emailSubject || !emailBody) {
      return NextResponse.json(
        { error: "Missing subject or body" },
        { status: 400 }
      )
    }

    // 2️⃣ Fetch sender
    const { data: settings } = await admin
      .from("sender_settings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const senderName = settings?.sender_name || "Outreach Team"
    const senderEmail = process.env.SMTP_USER!

    const signatureBlock = buildSignatureHtml(settings || {})

    // 3️⃣ Fetch leads
    const { data: leads } = await admin
      .from("leads")
      .select("id, company_name, email")
      .in("id", leadIds)

    if (!leads || leads.length === 0) {
      return NextResponse.json(
        { error: "No leads found" },
        { status: 404 }
      )
    }

    // 🔥 KEY FIX — FILTER VALID EMAILS
    const validLeads = leads.filter(
      (l) => l.email && l.email.includes("@")
    )

    const skippedLeads = leads.length - validLeads.length

    if (validLeads.length === 0) {
      return NextResponse.json(
        { error: "No valid emails found" },
        { status: 400 }
      )
    }

    // 4️⃣ Transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    // 5️⃣ Send emails safely
    let sentCount = 0

    for (const lead of validLeads) {
      try {
        await transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: lead.email!,
          subject: emailSubject,
          html: `
            <div style="font-family: Arial; padding:20px;">
              ${emailBody}
              ${signatureBlock}
            </div>
          `,
        })

        sentCount++
      } catch (err) {
        console.error(`Failed for ${lead.email}:`, err)
      }
    }

    // 6️⃣ Update ONLY sent leads
    await admin
      .from("leads")
      .update({ status: "contacted" })
      .in("id", validLeads.map((l) => l.id))

    return NextResponse.json({
      success: true,
      sent: sentCount,
      skipped: skippedLeads,
    })

  } catch (error) {
    console.error("send-email error:", error)
    return NextResponse.json(
      { error: "Failed to send emails" },
      { status: 500 }
    )
  }
}