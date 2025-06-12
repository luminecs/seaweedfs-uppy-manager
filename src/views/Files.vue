<!-- src/views/Files.vue -->
<template>
  <div class="space-y-6">
    <h1 class="text-3xl font-bold text-gray-800">
      Bucket: <span class="text-indigo-600">{{ bucketName }}</span>
    </h1>

    <!-- Upload Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Upload Files to this Bucket</h2>
      <Dashboard v-if="uppy" :uppy="uppy" :props="{ theme: 'light', proudllyDisplayPoweredByUppy: false }" />
    </div>

    <!-- File List Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Files in Bucket</h2>
      <div v-if="loading.list" class="text-center">Loading files...</div>
      <div v-else-if="error.list" class="text-red-500">{{ error.list }}</div>
      <table v-else-if="files.length" class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
        <tr>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Modified</th>
          <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
        <tr v-for="file in files" :key="file.Key">
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ file.Key }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ formatBytes(file.Size) }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ new Date(file.LastModified).toLocaleString() }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <button @click="deleteFile(file.Key)" class="text-red-600 hover:text-red-800 disabled:text-gray-400" :disabled="loading.delete === file.Key">
              <span v-if="loading.delete === file.Key">Deleting...</span>
              <span v-else>Delete</span>
            </button>
          </td>
        </tr>
        </tbody>
      </table>
      <p v-else class="text-gray-500">No files found in this bucket.</p>
    </div>
  </div>
</template>

<!-- src/views/Files.vue -->
<script setup>
import { ref, reactive, onMounted, onUnmounted, defineProps } from 'vue';
import { s3Client } from '../s3Client';
import {
  ListObjectsV2Command,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  PutObjectCommand, // <-- 用于单文件上传
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { Dashboard } from '@uppy/vue';
import Uppy from '@uppy/core';
import AwsS3Multipart from '@uppy/aws-s3-multipart';

const props = defineProps({
  bucketName: {
    type: String,
    required: true,
  },
});

const files = ref([]);
const loading = reactive({ list: false, delete: null });
const error = reactive({ list: null });
const uppy = ref(null);

// ... formatBytes, deleteFile, fetchFiles 函数保持不变 ...
async function fetchFiles() {
  loading.list = true;
  error.list = null;
  try {
    const { Contents } = await s3Client.send(new ListObjectsV2Command({ Bucket: props.bucketName }));
    // 确保刷新时按时间倒序排列
    files.value = (Contents || []).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  } catch (e) {
    error.list = `Failed to fetch files: ${e.message}`;
    console.error(e);
  } finally {
    loading.list = false;
  }
}
async function deleteFile(key) {
  if (!confirm(`Are you sure you want to delete the file "${key}"?`)) {
    return;
  }
  loading.delete = key;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: props.bucketName, Key: key }));
    await fetchFiles(); // Refresh list
  } catch (e) {
    alert(`Failed to delete file: ${e.message}`);
    console.error(e);
  } finally {
    loading.delete = null;
  }
}
const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};


onMounted(() => {
  fetchFiles();

  uppy.value = new Uppy({
    autoProceed: true,
    debug: true,
    // 明确设置最小分片大小，例如 10MB，以确保大文件走分片
    restrictions: {
      minPartSize: 10 * 1024 * 1024,
    }
  }).use(AwsS3Multipart, {
    // 设置并发上传的分片数量，避免过多请求
    limit: 5,

    // ======  非分片上传（小文件） ======
    // 只接收 file 参数
    getUploadParameters: async (file) => {
      console.log(`[Non-Multipart] Getting presigned URL for SINGLE FILE: ${file.name}`);
      try {
        const command = new PutObjectCommand({
          Bucket: props.bucketName,
          Key: file.name,
          ContentType: file.type,
          // ContentLength: file.size // 可选
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15分钟
        return { method: 'PUT', url: presignedUrl, fields: {}, headers: {} };
      } catch(e) {
        console.error(`[Non-Multipart] Error:`, e);
        throw e;
      }
    },

    // ====== 分片上传（大文件） ======
    // 1. 开始
    createMultipartUpload: async (file) => {
      console.log('[Multipart] Creating for:', file.name);
      try {
        const command = new CreateMultipartUploadCommand({
          Bucket: props.bucketName,
          Key: file.name,
          ContentType: file.type,
        });
        const data = await s3Client.send(command);
        return { uploadId: data.UploadId, key: data.Key };
      } catch(e) {
        console.error(`[Multipart] Create Error:`, e);
        throw e;
      }
    },

    // 2. 核心：为每个分片签名 (代替了 getUploadParameters 的分片逻辑)
    signPart: async (file, { uploadId, partNumber, key, body, signal }) => {
      console.log(`[Multipart] Signing PART: ${partNumber} for ${file.name}`);
      try {
        const command = new UploadPartCommand({
          Bucket: props.bucketName,
          Key: key, // 使用 create 返回的 key
          UploadId: uploadId,
          PartNumber: partNumber,
          // Body: body, // 不要在这里传Body，让 Uppy 自己去PUT
          // ContentLength: body.size // 确保签名时包含长度
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
        // signPart 期望返回 { url: '...' }
        return { url: presignedUrl };
      } catch(e) {
        console.error(`[Multipart] SignPart ${partNumber} Error:`, e);
        throw e;
      }
    },

    // 3. 完成
    completeMultipartUpload: async (file, { uploadId, key, parts }) => {
      console.log('[Multipart] Completing for:', file.name, 'Parts:', parts.length);
      try {
        // 确保 parts 按 PartNumber 排序，S3 API 要求
        const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber);
        const command = new CompleteMultipartUploadCommand({
          Bucket: props.bucketName,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: sortedParts },
        });
        const data = await s3Client.send(command);
        return { location: data.Location };
      } catch(e) {
        console.error(`[Multipart] Complete Error:`, e);
        throw e;
      }
    },

    // 4. 中止
    abortMultipartUpload: async (file, { uploadId, key }) => {
      console.log('[Multipart] Aborting for:', file.name);
      try {
        const command = new AbortMultipartUploadCommand({
          Bucket: props.bucketName,
          Key: key,
          UploadId: uploadId,
        });
        await s3Client.send(command);
      }  catch(e) {
        console.error(`[Multipart] Abort Error:`, e);
        throw e;
      }
    },
    // listParts: 可以不提供，除非要实现复杂的断点续传
  });

  // --- 刷新逻辑 ---
  uppy.value.on('upload-success', (file, response) => {
    console.log(`${file.name} uploaded successfully!`);
    const newFile = {
      Key: file.name,
      Size: file.size,
      LastModified: new Date().toISOString(),
    };
    // 检查是否已存在，避免乐观更新和刷新时的重复
    if (!files.value.some(f => f.Key === newFile.Key)) {
      files.value.unshift(newFile);
      // 保持排序
      files.value.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    }
  });

  uppy.value.on('complete', (result) => {
    console.log('All uploads complete, queueing refresh...');
    if (result.successful.length > 0 || result.failed.length > 0) {
      // 无论成功失败，只要有操作就刷新
      setTimeout(() => {
        console.log('Refreshing list from server now.');
        fetchFiles(); // 确保 fetchFiles 内部有排序
      }, 2000); // 增加延迟到2秒
    }
    if (result.failed.length > 0) {
      console.error('Some uploads failed:', result.failed);
    }
  });
  // --- 刷新逻辑 End ---

});

onUnmounted(() => {
  if (uppy.value) {
    uppy.value.close();
  }
});
</script>
