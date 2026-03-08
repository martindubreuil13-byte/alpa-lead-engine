import nodemailer from "nodemailer"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { to, subject, html, leadId } = await req.json()

    if (!to || !subject || !html) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // SMTP from .env.local
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    await transporter.sendMail({
      from: `"Quebec Outreach" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    })

    // Update lead after send
    const now = new Date()
    const followup = new Date()
    followup.setDate(now.getDate() + 7)

    if (leadId) {
      await admin
        .from("leads")
        .update({
          status: "first_contact_sent",
          first_contact_at: now.toISOString(),
          last_contact_at: now.toISOString(),
          followup_due_at: followup.toISOString(),
        })
        .eq("id", leadId)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("send-email error:", error)
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 })
  }
}