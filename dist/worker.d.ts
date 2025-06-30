interface Env {
    POCKETBASE_URL?: string;
    POCKETBASE_ADMIN_EMAIL?: string;
    POCKETBASE_ADMIN_PASSWORD?: string;
    STRIPE_SECRET_KEY?: string;
    SENDGRID_API_KEY?: string;
    EMAIL_SERVICE?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    DEFAULT_FROM_EMAIL?: string;
}
declare const _default: {
    fetch(request: Request, env: Env, ctx: any): Promise<Response>;
};
export default _default;
