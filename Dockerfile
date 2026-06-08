FROM public.ecr.aws/lambda/nodejs:22

# System dependencies (Amazon Linux / dnf)
RUN dnf install -y \
    atk cups-libs gtk3 libXcomposite libXdamage libXext \
    libXfixes libXrandr mesa-libgbm pango alsa-lib \
    nss nspr

WORKDIR ${LAMBDA_TASK_ROOT}

COPY package*.json ./
RUN npm install

COPY . .

# IMPORTANT: set path first
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# ✅ IMPORTANT FIX (NO --with-deps)
RUN npx playwright install chromium

CMD ["index.handler"]