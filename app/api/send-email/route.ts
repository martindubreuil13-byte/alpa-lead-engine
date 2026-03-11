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

    // 1) Resolve subject/body
    let emailSubject = payload.subject || ""
    let emailBody = payload.body || ""

    if ((!emailSubject || !emailBody) && templateId) {
      const { data: template, error: templateError } = await admin
        .from("email_templates")
        .select("subject, body")
        .eq("id", templateId)
        .single()

      if (templateError || !template) {
        console.error("Template fetch error:", templateError)
        return NextResponse.json(
          { error: "Template not found" },
          { status: 404 }
        )
      }

      emailSubject = template.subject || ""
      emailBody = template.body || ""
    }

    console.log("📨 SUBJECT RECEIVED:", emailSubject)
    console.log("📨 BODY RECEIVED:", emailBody)

    if (!emailSubject || !emailBody) {
      return NextResponse.json(
        { error: "Missing subject or body" },
        { status: 400 }
      )
    }

    // 2) Fetch sender settings
    const { data: settings } = await admin
      .from("sender_settings")
      .select("sender_name, sender_email, company_name, job_title, phone, website, logo_url")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const senderName = settings?.sender_name || "Outreach Team"
    const senderEmail = settings?.sender_email || process.env.SMTP_USER

    // Safety fallback: many SMTP providers reject mismatched From addresses
    const safeSenderEmail = process.env.SMTP_USER || senderEmail

    const signatureBlock = buildSignatureHtml({
      senderName: settings?.sender_name,
      senderEmail: settings?.sender_email,
      companyName: settings?.company_name,
      jobTitle: settings?.job_title,
      phone: settings?.phone,
      website: settings?.website,
      logoUrl: settings?.logo_url,
    })

    // 3) Fetch leads
    const { data: leads, error: leadsError } = await admin
      .from("leads")
      .select("id, company_name, email")
      .in("id", leadIds)

    if (leadsError || !leads || leads.length === 0) {
      console.error("Lead fetch error:", leadsError)
      return NextResponse.json(
        { error: "Failed to fetch leads" },
        { status: 500 }
      )
    }

    // 4) Transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    // 5) Send emails
    for (const lead of leads) {
      await transporter.sendMail({
        from: `"${senderName}" <${safeSenderEmail}>`,
        to: lead.email,
        subject: emailSubject,
        html: `
          <!DOCTYPE html>
          <html>
            <body style="margin:0;padding:0;background:#ffffff;">
              <div style="
                font-family: Arial, sans-serif;
                font-size: 14px;
                line-height: 1.6;
                color: #111111;
                padding: 24px;
                max-width: 640px;
              ">
                ${emailBody}
                ${signatureBlock}
              </div>
            </body>
          </html>
        `,
      })
    }

    // 6) Update lead status
    await admin
      .from("leads")
      .update({ status: "contacted" })
      .in("id", leadIds)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("send-email error:", error)
    return NextResponse.json(
      { error: "Failed to send emails" },
      { status: 500 }
    )
  }
}