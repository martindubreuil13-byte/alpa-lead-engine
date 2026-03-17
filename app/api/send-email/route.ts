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

    console.log("📥 REQUEST RECEIVED:", {
      leadCount: leadIds?.length,
      templateId,
    })

    if (!leadIds || leadIds.length === 0) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 })
    }

    // 1️⃣ Resolve subject/body
    let emailSubject = payload.subject || ""
    let emailBody = payload.body || ""

    if ((!emailSubject || !emailBody) && templateId) {
      const { data: template, error: templateError } = await admin
        .from("email_templates")
        .select("subject, body")
        .eq("id", templateId)
        .single()

      if (templateError || !template) {
        console.error("❌ Template fetch failed:", templateError)
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

    console.log("📨 SUBJECT:", emailSubject)

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
    const { data: leads, error: leadsError } = await admin
      .from("leads")
      .select("id, company_name, email")
      .in("id", leadIds)

    if (leadsError || !leads || leads.length === 0) {
      console.error("❌ Lead fetch error:", leadsError)
      return NextResponse.json(
        { error: "No leads found" },
        { status: 404 }
      )
    }

    console.log("📊 TOTAL LEADS:", leads.length)

    // 🔥 FILTER VALID EMAILS
    const validLeads = leads.filter(
      (l) => l.email && l.email.includes("@")
    )

    const skippedLeads = leads.length - validLeads.length

    console.log("✅ VALID EMAILS:", validLeads.length)
    console.log("⛔ SKIPPED (NO EMAIL):", skippedLeads)

    if (validLeads.length === 0) {
      return NextResponse.json(
        { error: "No valid emails found" },
        { status: 400 }
      )
    }

    // 4️⃣ SMTP CONFIG LOG
    console.log("📡 SMTP CONFIG:", {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: Number(process.env.SMTP_PORT) === 465,
      user: process.env.SMTP_USER ? "SET" : "MISSING",
      pass: process.env.SMTP_PASS ? "SET" : "MISSING",
    })

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    // 🔥 OPTIONAL HARD TEST SWITCH
    const FORCE_TEST_EMAIL = false
    const TEST_EMAIL = process.env.SMTP_USER

    let sentCount = 0
    const failed: string[] = []

    // 5️⃣ SEND EMAILS
    for (const lead of validLeads) {
      const recipient = FORCE_TEST_EMAIL ? TEST_EMAIL : lead.email!

      console.log("📤 SENDING:", {
        company: lead.company_name,
        to: recipient,
      })

      try {
        await transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: recipient,
          subject: emailSubject,
          html: `
            <div style="font-family: Arial; padding:20px;">
              ${emailBody}
              ${signatureBlock}
            </div>
          `,
        })

        sentCount++
      } catch (err: any) {
        console.error(`❌ FAILED: ${recipient}`, err?.message || err)
        failed.push(recipient)
      }
    }

    // 6️⃣ UPDATE ONLY SUCCESSFUL LEADS
    const successfulLeads = validLeads
      .slice(0, sentCount)
      .map((l) => l.id)

    if (successfulLeads.length > 0) {
      await admin
        .from("leads")
        .update({ status: "contacted" })
        .in("id", successfulLeads)
    }

    console.log("🎯 RESULT:", {
      sent: sentCount,
      skipped: skippedLeads,
      failed: failed.length,
    })

    return NextResponse.json({
      success: true,
      sent: sentCount,
      skipped: skippedLeads,
      failed,
    })

  } catch (error: any) {
    console.error("💥 send-email error:", error?.message || error)
    return NextResponse.json(
      { error: error?.message || "Failed to send emails" },
      { status: 500 }
    )
  }
}